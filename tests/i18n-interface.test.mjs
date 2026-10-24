import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../lib/i18n/dictionaries.ts', import.meta.url), 'utf8');
const catalog = {};
new Function('exports', ts.transpile(source, { module: ts.ModuleKind.CommonJS }))(catalog);
const { en, es, translate, translateMessage, formatTranslation } = catalog;

test('EN/ES keys and interpolation slots match; English remains the source', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  for (const key of Object.keys(en)) {
    assert.equal(en[key], key);
    assert.ok(es[key].trim(), key);
    assert.deepEqual(es[key].match(/\{\w+\}/g)?.sort() ?? [], key.match(/\{\w+\}/g)?.sort() ?? [], key);
  }
});
test('approved headline and default language', () => {
  assert.equal(translate('en', 'Leave something'), 'Leave something');
  assert.equal(`${translate('es', 'Leave something')} ${translate('es', 'that stays.')}`, 'Deja un legado que perdure.');
  assert.equal(translateMessage('es', 'Confidence is designed. Trust is earned. Continuity is intentional.'), 'Confidence is designed. Trust is earned. Continuity is intentional.');
});
test('interpolation preserves personal values, URLs and braces verbatim', () => {
  const recipient = 'Active {recipient} María <test@example.com> https://example.com';
  const result = formatTranslation('es', 'Delete this message for {recipient} and its attachments? This cannot be undone. Files used by another message will be retained.', { recipient });
  assert.ok(result.includes(recipient));
  assert.equal(translateMessage('es', 'unknown_server_code: 42'), 'unknown_server_code: 42');
});
test('displaying loader issues and deadlines does not change source states or dates', () => {
  assert.equal(translateMessage('es', 'Photo 2: The saved file could not be accessed. Voice: The content could not be decrypted.'), 'Foto 2: No se pudo acceder al archivo guardado. Voz: No se pudo descifrar el contenido.');
  assert.equal(translateMessage('es', 'Preparation ends: Oct 25, 2026 UTC'), 'La preparación termina: Oct 25, 2026 UTC');
  assert.equal(translateMessage('es', 'Deletion blocked. Deletion is disabled.'), 'Eliminación bloqueada. La eliminación está deshabilitada.');
});

test('all literal interface translation calls have EN/ES entries', () => {
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file)) {
        const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        function visit(node) {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['ui', 't', 'format'].includes(node.expression.text)) {
            const key = node.arguments[0];
            if (key && ts.isStringLiteral(key)) assert.ok(Object.hasOwn(en, key.text), `${file}: ${key.text}`);
          }
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
    }
  }
  walk('app'); walk('components');
});
