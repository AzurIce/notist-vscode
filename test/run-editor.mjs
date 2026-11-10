import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (!process.env.VSCODE_EXECUTABLE || !process.env.NOTIST_BIN) {
  throw new Error('Set VSCODE_EXECUTABLE to a VS Code/Codium executable and NOTIST_BIN to the Notist CLI absolute path.');
}
const extension = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'notist-editor-'));
const workspace = path.join(temp, 'workspace');
mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
writeFileSync(path.join(workspace, '.vscode/settings.json'), JSON.stringify({
  'notist.server.path': process.env.NOTIST_BIN,
  'notist.trace.server': 'verbose',
}));
writeFileSync(path.join(workspace, 'lib.notc'), 'fn badge() -> InlineContent { [Badge] }');
for (const suffix of ['md', 'nmd', 'notmd']) {
  writeFileSync(path.join(workspace, `page.${suffix}`), '#import "lib.notc": badge;\n\n#badge()\n\n#unknown()\n');
}
console.log(`Editor test artifacts: ${temp}`);
const result = spawnSync(process.env.VSCODE_EXECUTABLE, [
  '--wait', '--no-sandbox', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
  '--user-data-dir', path.join(temp, 'user'), '--extensions-dir', path.join(temp, 'extensions'),
  `--extensionDevelopmentPath=${extension}`, `--extensionTestsPath=${path.join(extension, 'test/editor/index.cjs')}`,
  workspace,
], { stdio: 'inherit', timeout: 120000 });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(readFileSync(path.join(workspace, 'passed'), 'utf8'));
