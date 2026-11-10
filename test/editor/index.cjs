const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function eventually(check, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

exports.run = async () => {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const extension = vscode.extensions.all.find(extension => extension.packageJSON.name === 'notist-vscode');
  assert.ok(extension, 'extension discovered');
  const uri = vscode.Uri.file(path.join(root, 'page.md'));
  let document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  assert.equal(document.languageId, 'markdown');
  assert.equal(extension.isActive, false, 'ordinary Markdown must not activate Notist');
  document = await vscode.languages.setTextDocumentLanguage(document, 'notist-markdown');
  await eventually(() => extension.isActive, 'language switch activates extension');
  const position = new vscode.Position(2, 3);
  const hover = await eventually(async () => {
    const result = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position);
    return result?.some(hover => hover.contents.some(content => String(content.value ?? content).includes('badge'))) && result;
  }, 'Notist function hover');
  assert.ok(hover.length);
  const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position);
  assert.equal(definitions[0].uri.fsPath, path.join(root, 'lib.notc'));
  await eventually(() => vscode.languages.getDiagnostics(uri).some(diagnostic => diagnostic.source?.startsWith('notist:')), 'Notist diagnostics');
  await vscode.languages.setTextDocumentLanguage(document, 'markdown');
  await eventually(() => !vscode.languages.getDiagnostics(uri).some(diagnostic => diagnostic.source?.startsWith('notist:')), 'switching back clears diagnostics');
  for (const suffix of ['nmd', 'notmd']) {
    const target = vscode.Uri.file(path.join(root, `page.${suffix}`));
    const opened = await vscode.workspace.openTextDocument(target);
    assert.equal(opened.languageId, 'notist-markdown');
    await eventually(async () => {
      const result = await vscode.commands.executeCommand('vscode.executeHoverProvider', target, position);
      return result?.some(hover => hover.contents.some(content => String(content.value ?? content).includes('badge')));
    }, `${suffix} hover`);
  }
  fs.writeFileSync(path.join(root, 'passed'), 'activation, language switch, hover, definition, diagnostics, nmd, notmd\n');
  console.log('Notist editor end-to-end checks passed');
};
