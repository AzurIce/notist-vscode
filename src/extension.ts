import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';

const languages = new Set(['notist', 'notist-code', 'notist-markdown']);
const clients = new Map<string, { client: LanguageClient; watchers: vscode.FileSystemWatcher[] }>();
let pending = Promise.resolve();
let disposed = false;
let output: vscode.OutputChannel;

function enqueue(task: () => Promise<void>): Promise<void> {
  pending = pending.then(task).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(message);
    void vscode.window.showErrorMessage(`Notist: ${message}. Check notist.server.path and the Notist output channel.`);
  });
  return pending;
}

async function start(document: vscode.TextDocument): Promise<void> {
  if (disposed || !vscode.workspace.isTrusted || document.uri.scheme !== 'file' || !languages.has(document.languageId)) {
    return;
  }
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const root = folder?.uri ?? vscode.Uri.file(path.dirname(document.uri.fsPath));
  const key = root.toString();
  if (clients.has(key)) return;

  const config = vscode.workspace.getConfiguration('notist', root);
  const command = config.get<string>('server.path', 'notist');
  const args = config.get<string[]>('server.args', ['lsp']);
  const server: ServerOptions = { command, args, options: { cwd: root.fsPath } };
  const watchers = [
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*.{not,notc,nmd,notmd,md,markdown}')),
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/Notist.toml')),
  ];
  const options: LanguageClientOptions = {
    documentSelector: [...languages].map(language => ({
      language,
      scheme: 'file',
      // LanguageClient uses protocol selectors, whose patterns are glob strings.
      pattern: `${root.fsPath.replace(/\\/g, '/').replace(/[?*\[\]{}]/g, '[$&]').replace(/\/$/, '')}/${folder ? '**/*' : '*'}`,
    })),
    workspaceFolder: folder,
    outputChannel: output,
    synchronize: { fileEvents: watchers },
  };
  const client = new LanguageClient('notist', `Notist (${path.basename(root.fsPath)})`, server, options);
  clients.set(key, { client, watchers });
  try {
    output.appendLine(`Starting ${command} ${JSON.stringify(args)} in ${root.fsPath}`);
    await client.start();
    output.appendLine(`Language server ready for ${root.fsPath}`);
  } catch (error) {
    clients.delete(key);
    watchers.forEach(watcher => watcher.dispose());
    await client.dispose();
    throw error;
  }
}

async function stop(): Promise<void> {
  const running = [...clients.values()];
  clients.clear();
  await Promise.all(running.map(async ({ client, watchers }) => {
    watchers.forEach(watcher => watcher.dispose());
    await client.dispose();
  }));
}

async function startOpenDocuments(): Promise<void> {
  for (const document of vscode.workspace.textDocuments) {
    // One missing executable must not prevent other workspace folders from starting.
    try {
      await start(document);
    } catch (error) {
      output.appendLine(String(error));
      void vscode.window.showErrorMessage('Notist: Could not start the language server. Check notist.server.path and the Notist output channel.');
    }
  }
}

export function activate(context: vscode.ExtensionContext): Promise<void> {
  disposed = false;
  output = vscode.window.createOutputChannel('Notist');
  context.subscriptions.push(
    output,
    vscode.workspace.onDidOpenTextDocument(document => { void enqueue(() => start(document)); }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { void enqueue(startOpenDocuments); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void enqueue(restart); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('notist.server')) void enqueue(restart);
    }),
    vscode.commands.registerCommand('notist.restartLanguageServer', () => enqueue(restart)),
  );
  return enqueue(startOpenDocuments);
}

async function restart(): Promise<void> {
  await stop();
  await startOpenDocuments();
}

export async function deactivate(): Promise<void> {
  disposed = true;
  await pending;
  await stop();
}
