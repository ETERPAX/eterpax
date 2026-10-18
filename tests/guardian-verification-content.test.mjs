import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function harness(overrides = {}) {
  const env = { GUARDIAN_VERIFICATION_RESPONSE_ENABLED: 'true',
    GUARDIAN_VERIFICATION_QUESTION: "Please confirm the situation regarding [Owner's Name].",
    GUARDIAN_VERIFICATION_POSITIVE_LABEL: 'Yes, I can confirm',
    GUARDIAN_VERIFICATION_NEGATIVE_LABEL: 'No, the owner is okay', ...overrides };
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const file = name === 'route' ? 'app/guardian-verification/route.ts' : `lib/continuity/${name}.ts`;
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    }}).outputText;
    const exports = {};
    vm.runInNewContext(code, { exports, process: { env }, Response,
      require: id => id === 'server-only' ? {} : id === 'node:crypto' ? require(id) : load(id.split('/').at(-1)) });
    return cache[name] = exports;
  }
  return { content: load('guardian-verification-content'), config: load('guardian-verification-config'), route: load('route') };
}
test('real route exposes matching contract and visible labels; no identity required', async () => {
  const h = harness(); const r = await h.route.GET(); const html = await r.text();
  assert.equal(r.status, 200); h.content.verifyGuardianVerificationContent(html);
  assert(html.includes('<p id="question"></p>'));
  assert(html.includes('/api/guardian-verification/context'));
});
test('missing, duplicate, altered contract and altered visible labels are rejected', async () => {
  const h = harness(); const html = await (await h.route.GET()).text();
  const meta = h.content.guardianVerificationContractHtml();
  for (const changed of [html.replace(meta, ''), html + meta,
    html.replace('&quot;version&quot;:1', '&quot;version&quot;:2'),
    html.replace('Please confirm', 'Different question'),
    html.replace('required> Yes, I can confirm', 'required> Different answer')]) {
    assert.throws(() => h.content.verifyGuardianVerificationContent(changed), /deployed copy mismatch/);
  }
  assert.throws(() => harness({GUARDIAN_VERIFICATION_POSITIVE_LABEL:'Different'}).content.verifyGuardianVerificationContent(html));
});
test('HTML and attributes escape hostile text without changing contract values', async () => {
  const attack = '\"><script>alert(1)</script>&\'';
  const h = harness({ GUARDIAN_VERIFICATION_QUESTION: `[Owner's Name] ${attack}`, GUARDIAN_VERIFICATION_POSITIVE_LABEL: attack });
  const html = await (await h.route.GET()).text();
  assert(!html.includes(attack)); assert(html.includes('&lt;script&gt;')); assert(html.includes('&quot;'));
  h.content.verifyGuardianVerificationContent(html);
});
test('personalization uses same template and validates identity', () => {
  const h = harness();
  assert.equal(h.config.guardianVerificationIdentityQuestion('Alex'), 'Please confirm the situation regarding Alex.');
  assert(h.content.guardianVerificationContent().question.includes("[Owner's Name]"));
  assert.throws(() => h.config.guardianVerificationIdentityQuestion(''));
});
test('unapproved negative label fails closed; disabled route stays unavailable', async () => {
  const h = harness({GUARDIAN_VERIFICATION_NEGATIVE_LABEL:"No, [Owner's Name] is okay"});
  assert.throws(() => h.content.guardianVerificationContent());
  assert.equal((await h.route.GET()).status, 503);
  assert.equal((await harness({GUARDIAN_VERIFICATION_RESPONSE_ENABLED:'false'}).route.GET()).status, 503);
});
