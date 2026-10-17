import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
const require = createRequire(import.meta.url), ts = require('typescript');
const root = new URL('../', import.meta.url);
const tokens = [Buffer.alloc(32, 1).toString('base64url'), Buffer.alloc(32, 2).toString('base64url')];
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const digest = t => '\\x' + createHash('sha256').update(t).digest('hex');
function harness(options = {}) {
  const calls = [], auth = [];
  const env = { GUARDIAN_VERIFICATION_RESPONSE_ENABLED: 'true', NEXT_PUBLIC_SITE_URL: 'https://site.example',
    SUPABASE_URL: 'https://database.example', SUPABASE_SECRET_KEY: 'synthetic-secret',
    GUARDIAN_VERIFICATION_QUESTION: "Can you confirm that [Owner's Name] has passed away or is unable to respond due to a serious medical condition?",
    GUARDIAN_VERIFICATION_POSITIVE_LABEL: 'Yes, I can confirm', GUARDIAN_VERIFICATION_NEGATIVE_LABEL: 'No, the owner is okay', ...options.env };
  const counts = new Map();
  const client = {
    rpc(name, args) {
      assert.equal(name, 'get_guardian_verification_owner'); calls.push(args);
      const index = tokens.findIndex(t => digest(t) === args.p_token_digest);
      const count = (counts.get(index) ?? 0) + 1; counts.set(index, count);
      return { async abortSignal(signal) {
        assert(signal instanceof AbortSignal);
        if (options.throwRpc) throw Error(tokens[0]);
        return { data: index < 0 || options.invalid || (options.cancelAfterAuth && count > 1) ? null : ids[index], error: null };
      } };
    },
    auth: { admin: { async getUserById(id) {
      auth.push(id);
      return { data: { user: { id: options.wrongOwner ? ids[1] : id,
        user_metadata: options.metadata ?? { firstName: id === ids[0] ? 'Juan José' : 'María Elena' } } }, error: null };
    } } },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText, { exports, process: { env }, Response, Request, URL, Buffer, AbortSignal,
      require(name) {
        if (name === 'server-only') return {};
        if (name.startsWith('node:')) return require(name);
        if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name === '@supabase/supabase-js') return { createClient(url, key) {
          assert.equal(url, env.SUPABASE_URL); assert.equal(key, env.SUPABASE_SECRET_KEY); return client;
        } };
        throw Error(name);
      },
    }); return exports;
  }
  return { calls, auth, load, request: (token = tokens[0], extra = {}) => load('lib/continuity/guardian-verification-context.ts').getGuardianVerificationContext(
    new Request(env.NEXT_PUBLIC_SITE_URL + '/api/guardian-verification/context' + (extra.query ?? ''), {
      method: 'POST', headers: { origin: extra.origin ?? env.NEXT_PUBLIC_SITE_URL, 'content-type': extra.type ?? 'application/json' },
      body: extra.body ?? JSON.stringify({ token }),
    })) };
}
test('concurrent A/B lookup discloses only the corresponding complete firstName and only hashes reach SQL', async () => {
  const h = harness();
  const responses = await Promise.all(tokens.map(t => h.request(t)));
  for (const [i, r] of responses.entries()) {
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    const body = await r.json(); assert.deepEqual(Object.keys(body), ['question']);
    assert(body.question.includes(i === 0 ? 'Juan José' : 'María Elena'));
    assert(!body.question.includes(i === 0 ? 'María Elena' : 'Juan José'));
    assert(!JSON.stringify(body).includes(tokens[i])); assert(!JSON.stringify(body).includes(ids[i]));
  }
  assert.equal(h.calls.length, 4); assert.equal(h.auth.length, 2);
  for (const t of tokens) assert(!JSON.stringify(h.calls).includes(t));
});
test('unavailable credentials and cancellation during Auth never return identity', async () => {
  for (const option of [{ invalid: true }, { cancelAfterAuth: true }, { wrongOwner: true }, { throwRpc: true }]) {
    const h = harness(option), r = await h.request();
    assert.notEqual(r.status, 200); assert.deepEqual(await r.json(), { outcome: 'unavailable' });
    if (option.invalid) assert.equal(h.auth.length, 0);
  }
  const h = harness(); const r = await h.request(Buffer.alloc(32, 3).toString('base64url'));
  assert.equal(r.status, 409); assert.equal(h.auth.length, 0);
});
test('missing, malformed firstName or missing marker fails closed without display_name fallback', async () => {
  for (const metadata of [{ display_name: 'Full Name' }, { firstName: '' }, { firstName: 1 }, { firstName: '  ' },
    { firstName: 'Juan\nJosé' }, { firstName: '\u202eJuan' }, { firstName: 'x'.repeat(201) }]) {
    const r = await harness({ metadata }).request(); assert.notEqual(r.status, 200);
    assert.deepEqual(await r.json(), { outcome: 'unavailable' });
  }
  assert.equal((await harness({ env: { GUARDIAN_VERIFICATION_QUESTION: 'No marker' } }).request()).status, 503);
});
test('malformed bodies, tokens, foreign origins and query strings are rejected before SQL', async () => {
  for (const extra of [{ body: '{}' }, { body: '{' }, { body: 'x'.repeat(1025) }, { body: JSON.stringify({ token: tokens[0], ownerId: ids[1] }) },
    { body: JSON.stringify({ token: 'bad' }) }, { origin: 'https://foreign.example' }, { query: '?extra=1' }, { type: 'text/plain' }]) {
    const h = harness(); assert.notEqual((await h.request(tokens[0], extra)).status, 200); assert.equal(h.calls.length, 0);
  }
});
async function browser(options = {}) {
  const h = harness(), response = await h.load('app/guardian-verification/route.ts').GET(), html = await response.text();
  assert(html.includes('<fieldset id="choices" disabled>'));
  assert(html.includes('value="positive" required> Yes, I can confirm'));
  assert(html.includes('value="negative" required> No, the owner is okay'));
  assert(!html.includes('UNABLE TO CONFIRM')); assert(!html.includes('localStorage')); assert(!html.includes('sessionStorage'));
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  const nonce = html.match(/<script nonce="([^"]+)"/)[1]; assert(response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
  const nodes = Object.fromEntries(['form', 'submit', 'status', 'choices', 'question'].map(id => [id, { disabled: true, textContent: '', addEventListener() {}, reportValidity: () => true }]));
  const requests = []; let cleared = false;
  vm.runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], {
    URLSearchParams, location: { hash: '#token=' + tokens[0], pathname: '/guardian-verification' },
    history: { replaceState(_state, _title, url) { assert.equal(url, '/guardian-verification'); cleared = true; } },
    document: { getElementById: id => nodes[id] },
    fetch: async (url, init) => {
      assert(cleared); assert.equal(nodes.submit.disabled, true); assert.equal(nodes.choices.disabled, true);
      assert.equal(url, '/api/guardian-verification/context'); assert.equal(init.method, 'POST'); assert.equal(init.cache, 'no-store');
      assert.deepEqual(JSON.parse(init.body), { token: tokens[0] }); requests.push(url);
      return options.failure ? Response.json({ outcome: 'unavailable' }, { status: 409 }) : Response.json({ question: '<b>Juan José</b> $&' });
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1); assert.equal(h.calls.length, 0);
  return nodes;
}
test('opening page only requests context; form enables after success and question uses literal text', async () => {
  const nodes = await browser(); assert.equal(nodes.submit.disabled, false); assert.equal(nodes.choices.disabled, false);
  assert.equal(nodes.question.textContent, '<b>Juan José</b> $&');
});
test('failed context keeps entire form disabled and reveals no question', async () => {
  const nodes = await browser({ failure: true }); assert.equal(nodes.submit.disabled, true);
  assert.equal(nodes.choices.disabled, true); assert.equal(nodes.question.textContent, '');
});
