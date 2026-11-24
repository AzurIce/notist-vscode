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
    if (scope === 'text.html.markdown' && process.env.VSCODE_MARKDOWN_GRAMMAR) {
      return JSON.parse(await readFile(process.env.VSCODE_MARKDOWN_GRAMMAR, 'utf8'));
    }
    const name = {
      'source.notist': 'notist',
      'text.html.markdown.notist': 'notist-markdown',
      'notist.markdown.injection': 'notist-markdown-injection',
    }[scope];
    return name ? JSON.parse(await readFile(new URL(`../syntaxes/${name}.tmLanguage.json`, import.meta.url), 'utf8')) : null;
  },
  getInjections: scope => scope === 'text.html.markdown.notist' ? ['notist.markdown.injection'] : [],
});

async function tokenize(source, scope = 'source.notist') {
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

test('notist code declarations, methods, strings, generics, comments and embedded content', async () => {
  const lines = await tokenize(
    'import "./math.not" as m;\nfn Block.banner<C: Type>(self, x: C) -> Block where C == Inline {\n let value = r##"raw"##;\n let text = """multi\nline""";\n let nums = (1_000, 2);\n callout("tip")[ #x and #strong[Hello] ]\n}',
    'source.notist',
  );
  hasScope(lines[0], 'import', 'keyword.control.notist');
  hasScope(lines[0], './math.not', 'string.quoted.double.notist');
  hasScope(lines[1], 'fn', 'keyword.control.notist');
  hasScope(lines[1], 'Block', 'support.type.notist');
  hasScope(lines[1], 'banner', 'entity.name.function.notist');
  hasScope(lines[1], 'self', 'variable.language.self.notist');
  hasScope(lines[1], 'where', 'keyword.control.notist');
  hasScope(lines[2], 'raw', 'string.quoted.double.raw.notist');
  hasScope(lines[4], 'line', 'string.quoted.triple.notist');
  hasScope(lines[5], '1_000', 'constant.numeric.notist');
  hasScope(lines[6], 'callout', 'entity.name.function.notist');
  hasScope(lines[6], 'x', 'variable.other.notist');
  hasScope(lines[6], 'strong', 'entity.name.function.notist');
});

test('nested block comments and URLs in code', async () => {
  const lines = await tokenize('/* outer /* inner */\nstill outer */\nlet u = "https://example.com"; // comment', 'source.notist');
  hasScope(lines[1], 'still', 'comment.block.notist');
  hasScope(lines[2], 'comment', 'comment.line.double-slash.notist');
  hasScope(lines[2], 'https:', 'string.quoted.double.notist');
});

test('unterminated single-line strings do not swallow declarations', async () => {
  const lines = await tokenize('let x = "oops\nfn next() -> Int { 1 }', 'source.notist');
  hasScope(lines[1], 'fn', 'keyword.control.notist');
});

test('hyphenated identifiers do not contain keywords or numeric literals', async () => {
  const [line] = await tokenize('let if-value = item-42;', 'source.notist');
  const scopes = line.tokens.filter(t => t.startIndex >= 4).flatMap(t => t.scopes);
  assert.ok(!scopes.includes('keyword.control.notist'));
  assert.ok(!scopes.includes('constant.numeric.notist'));
});

test('Notist Markdown injection highlights calls, imports, annotations and #(expr)', async () => {
  const lines = await tokenize('#import "./lib.not": badge;\n#pele.diagram(r#"raw"#)\n@!(title: "Doc", tags: ("a", "b"))\n@(id: "intro")\nValue: #(1 + 2)', 'notist.markdown.injection');
  hasScope(lines[0], 'import', 'keyword.control.notist');
  hasScope(lines[0], './lib.not', 'string.quoted.double.notist');
  hasScope(lines[1], 'pele.diagram', 'entity.name.function.notist');
  hasScope(lines[1], 'raw', 'string.quoted.double.raw.notist');
  hasScope(lines[2], 'title', 'variable.parameter.notist');
  hasScope(lines[3], 'id', 'variable.parameter.notist');
  hasScope(lines[4], '1', 'constant.numeric.notist');
});

test('Notist injection works inside real Markdown and leaves headings and code opaque', { skip: !process.env.VSCODE_MARKDOWN_GRAMMAR }, async () => {
  const lines = await tokenize('# Heading\n\nText #badge() and **bold**.\n\n`#literal()`\n\n```text\n#literal()\n```', 'text.html.markdown.notist');
  hasScope(lines[0], 'Heading', 'markup.heading.markdown');
  hasScope(lines[2], 'badge', 'entity.name.function.notist');
  for (const line of [lines[4], lines[7]]) {
    assert.ok(!line.tokens.some(token => token.scopes.includes('entity.name.function.notist')));
  }
});
