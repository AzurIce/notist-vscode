import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import textmate from 'vscode-textmate';
import oniguruma from 'vscode-oniguruma';

const require = createRequire(import.meta.url);
const wasm = await readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
const registry = new textmate.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
    createOnigString: value => new oniguruma.OnigString(value),
  }),
  loadGrammar: async scope => {
    const name = { 'text.notist': 'notist', 'source.notist.code': 'notist-code' }[scope];
    return name ? JSON.parse(await readFile(new URL(`../syntaxes/${name}.tmLanguage.json`, import.meta.url), 'utf8')) : null;
  },
});

async function tokenize(source, scope = 'text.notist') {
  const grammar = await registry.loadGrammar(scope);
  let state = textmate.INITIAL;
  return source.split('\n').map(line => {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    return { line, tokens: result.tokens };
  });
}

function hasScope(line, text, scope) {
  const offset = line.line.indexOf(text);
  assert.notEqual(offset, -1, `Missing text: ${text}`);
  const token = line.tokens.find(token => token.startIndex <= offset && token.endIndex > offset);
  assert.ok(token?.scopes.includes(scope), `${text}: expected ${scope}, got ${token?.scopes}`);
}

test('markup headings, emphasis, links, math, calls and annotations', async () => {
  const lines = await tokenize('= 标题\n*粗体* _斜体_ ~删除~\n[[page.not|标题]] [链接](https://example.com)\n$x + y$\n@(id: "intro")\n#组件(name: "值", n: 42)[*内容*]');
  hasScope(lines[0], '标题', 'markup.heading.notist');
  hasScope(lines[1], '粗体', 'markup.bold.notist');
  hasScope(lines[1], '斜体', 'markup.italic.notist');
  hasScope(lines[1], '删除', 'markup.strikethrough.notist');
  hasScope(lines[2], 'page.not', 'markup.underline.link.notist');
  hasScope(lines[2], 'https:', 'markup.underline.link.notist');
  hasScope(lines[3], 'x', 'markup.math.notist');
  hasScope(lines[4], 'id', 'variable.parameter.notist');
  hasScope(lines[4], 'intro', 'string.quoted.double.notist');
  hasScope(lines[5], '组件', 'entity.name.function.notist');
  hasScope(lines[5], '42', 'constant.numeric.notist');
  hasScope(lines[5], '内容', 'markup.bold.notist');
});

test('raw text is opaque, and matching fences restore markup', async () => {
  const lines = await tokenize('````not\n#not-a-call() *not-bold*\n```\nmore\n````\n= Heading\n`#literal()`');
  hasScope(lines[1], '#not', 'markup.raw.block.notist');
  hasScope(lines[3], 'more', 'markup.raw.block.notist');
  hasScope(lines[5], 'Heading', 'markup.heading.notist');
  hasScope(lines[6], '#literal', 'markup.raw.inline.notist');
});

test('nested block comments and URLs', async () => {
  const lines = await tokenize('/* outer /* inner */\nstill outer */\nhttps://example.com // comment');
  hasScope(lines[1], 'still', 'comment.block.notist');
  hasScope(lines[2], 'comment', 'comment.line.double-slash.notist');
  assert.ok(!lines[2].tokens.find(t => t.startIndex <= 8 && t.endIndex > 8).scopes.some(s => s.startsWith('comment.')));
});

test('code declarations, paths, strings, generics and embedded markup', async () => {
  const lines = await tokenize('fn item(source: Path) -> BlockContent {\n let x = p"./data.json";\n let value = r##"raw"##;\n let text = """multi\nline""";\n [#heading<2>[*Hello*]]\n}', 'source.notist.code');
  hasScope(lines[0], 'fn', 'keyword.control.notist');
  hasScope(lines[0], 'item', 'entity.name.function.notist');
  hasScope(lines[0], 'Path', 'support.type.notist');
  hasScope(lines[1], './data', 'string.quoted.double.path.notist');
  hasScope(lines[2], 'raw', 'string.quoted.double.raw.notist');
  hasScope(lines[4], 'line', 'string.quoted.triple.notist');
  hasScope(lines[5], 'heading', 'entity.name.function.notist');
  hasScope(lines[5], 'Hello', 'markup.bold.notist');
});

test('unterminated single-line strings do not swallow declarations', async () => {
  const lines = await tokenize('let x = "oops\nfn next() {}', 'source.notist.code');
  hasScope(lines[1], 'fn', 'keyword.control.notist');
});

test('hyphenated identifiers do not contain keywords or numeric literals', async () => {
  const [line] = await tokenize('let if-value = item-42;', 'source.notist.code');
  const scopes = line.tokens.filter(t => t.startIndex >= 4).flatMap(t => t.scopes);
  assert.ok(!scopes.includes('keyword.control.notist'));
  assert.ok(!scopes.includes('constant.numeric.notist'));
});
