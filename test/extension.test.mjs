import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/extension.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['vscode', 'vscode-languageclient/node'],
});

function harness() {
  const handlers = {};
  const instances = [];
  const watchers = [];
  const errors = [];
  const settings = { path: 'notist', args: ['lsp'] };
  let fail = false;
  const uri = file => ({ scheme: 'file', fsPath: file, toString: () => pathToFileURL(file).href });
  const folders = ['/project/a', '/project/b'].map(file => ({ uri: uri(file), name: path.basename(file), index: 0 }));
  const document = (file, languageId = 'notist') => ({ uri: uri(file), languageId });
  const disposable = () => ({ dispose() {} });
  const event = name => callback => { handlers[name] = callback; return disposable(); };
  const workspace = {
    isTrusted: true,
    textDocuments: [],
    getWorkspaceFolder: value => folders.find(folder => value.fsPath.startsWith(`${folder.uri.fsPath}/`)),
    getConfiguration: () => ({ get: key => key === 'server.path' ? settings.path : settings.args }),
    createFileSystemWatcher: pattern => {
      const watcher = { pattern, disposed: false, dispose() { this.disposed = true; } };
      watchers.push(watcher);
      return watcher;
    },
    onDidOpenTextDocument: event('open'),
    onDidGrantWorkspaceTrust: event('trust'),
    onDidChangeWorkspaceFolders: event('folders'),
    onDidChangeConfiguration: event('configuration'),
  };
  class LanguageClient {
    constructor(id, name, server, options) {
      Object.assign(this, { id, name, server, options, disposed: false, started: false });
      instances.push(this);
    }
    async start() { if (fail) throw new Error('ENOENT'); this.started = true; }
    async dispose() { this.disposed = true; }
  }
  const vscode = {
    workspace,
    Uri: { file: uri },
    RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
    window: {
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      showErrorMessage: async message => { errors.push(message); },
    },
    commands: { registerCommand: (_name, callback) => { handlers.restart = callback; return disposable(); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    require: name => name === 'vscode' ? vscode : name === 'vscode-languageclient/node' ? { LanguageClient } : name === 'node:path' ? path : null,
  });
  return {
    ...module.exports, workspace, instances, watchers, errors, handlers, settings, document,
    activate: () => module.exports.activate({ subscriptions: [] }),
    fail: value => { fail = value; },
  };
}

test('one client per workspace folder with correct command, cwd and selectors', async () => {
  const h = harness();
  h.settings.path = '/tools/notist';
  h.settings.args = ['lsp', '--config', '/config/Notist.toml'];
  h.workspace.textDocuments = [h.document('/project/a/a.not'), h.document('/project/a/b.notc', 'notist-code'), h.document('/project/b/a.not')];
  await h.activate();
  assert.equal(h.instances.length, 2);
  const client = h.instances[0];
  assert.equal(client.server.command, '/tools/notist');
  assert.equal(client.server.args[1], '--config');
  assert.equal(client.server.options.cwd, '/project/a');
  assert.equal(client.options.documentSelector[0].pattern, '/project/a/**/*');
  assert.equal(client.options.documentSelector[1].language, 'notist-code');
  await h.deactivate();
  assert.ok(h.instances.every(client => client.disposed));
  assert.ok(h.watchers.every(watcher => watcher.disposed));
});

test('untrusted workspaces do not execute the CLI; granting trust starts it', async () => {
  const h = harness();
  h.workspace.isTrusted = false;
  h.workspace.textDocuments = [h.document('/project/a/a.nmd', 'notist-markdown')];
  await h.activate();
  assert.equal(h.instances.length, 0);
  h.workspace.isTrusted = true;
  h.handlers.trust();
  await h.handlers.restart();
  assert.ok(h.instances.length > 0);
  assert.ok(h.instances.every(client => client.started));
  await h.deactivate();
});

test('Notist Markdown is registered without taking over ordinary Markdown files', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(!manifest.activationEvents?.includes('onLanguage:markdown'));
  assert.deepEqual(manifest.contributes.languages.find(language => language.id === 'notist-markdown').extensions, ['.nmd', '.notmd']);
  assert.ok(manifest.contributes.languages.every(language => language.id !== 'markdown'));
  assert.ok(manifest.contributes.grammars.every(grammar => grammar.language !== 'markdown'));
});

test('Notist Markdown-only workspaces start the server and synchronize documents and disk changes', async () => {
  const h = harness();
  h.workspace.textDocuments = [h.document('/project/a/a.nmd', 'notist-markdown'), h.document('/project/a/b.notmd', 'notist-markdown')];
  await h.activate();
  assert.equal(h.instances.length, 1);
  assert.ok(h.instances[0].started);
  const selector = h.instances[0].options.documentSelector.find(selector => selector.language === 'notist-markdown');
  assert.equal(selector.scheme, 'file');
  assert.equal(selector.pattern, '/project/a/**/*');
  assert.equal(h.watchers[0].pattern.pattern, '**/*.{not,notc,nmd,notmd,md,markdown}');
  assert.ok(h.watchers.every(watcher => h.instances[0].options.synchronize.fileEvents.includes(watcher)));
  assert.ok(h.instances[0].options.documentSelector.every(selector => selector.language !== 'markdown'));
  await h.deactivate();
});

test('switching standalone Markdown to Notist Markdown starts a server in its directory', async () => {
  const h = harness();
  await h.activate();
  h.workspace.textDocuments = [h.document('/loose/a.md', 'markdown')];
  await h.handlers.restart();
  assert.equal(h.instances.length, 0);
  const document = h.document('/loose/a.md', 'notist-markdown');
  h.workspace.textDocuments.push(document);
  h.handlers.open(document);
  // Deactivation waits for the queued open event without recreating clients.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.instances.length, 1);
  assert.equal(h.instances[0].server.options.cwd, '/loose');
  assert.equal(h.instances[0].options.documentSelector.find(selector => selector.language === 'notist-markdown').pattern, '/loose/*');
  await h.deactivate();
});

test('deactivation prevents queued events from starting a process', async () => {
  const h = harness();
  await h.activate();
  h.handlers.open(h.document('/project/a/a.not'));
  await h.deactivate();
  assert.equal(h.instances.length, 0);
});

test('standalone files use their parent directory and other languages are ignored', async () => {
  const h = harness();
  h.workspace.textDocuments = [h.document('/loose/a.not'), h.document('/loose/b.notc', 'notist-code'), h.document('/loose/a.ts', 'typescript')];
  await h.activate();
  assert.equal(h.instances.length, 1);
  assert.equal(h.instances[0].server.options.cwd, '/loose');
  assert.equal(h.instances[0].options.documentSelector[0].pattern, '/loose/*');
  await h.deactivate();
});

test('restart disposes clients and watchers before recreating them', async () => {
  const h = harness();
  h.workspace.textDocuments = [h.document('/project/a/a.not')];
  await h.activate();
  h.settings.path = '/new/notist';
  await h.handlers.restart();
  assert.equal(h.instances.length, 2);
  assert.ok(h.instances[0].disposed);
  assert.ok(h.watchers.slice(0, 2).every(watcher => watcher.disposed));
  assert.equal(h.instances[1].server.command, '/new/notist');
  await h.deactivate();
});

test('failed startup is reported, cleaned up and can be retried', async () => {
  const h = harness();
  h.fail(true);
  h.workspace.textDocuments = [h.document('/project/a/a.not')];
  await h.activate();
  assert.equal(h.errors.length, 1);
  assert.ok(h.instances[0].disposed);
  assert.ok(h.watchers.every(watcher => watcher.disposed));
  h.fail(false);
  await h.handlers.restart();
  assert.ok(h.instances[1].started);
  await h.deactivate();
});
