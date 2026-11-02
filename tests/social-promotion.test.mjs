import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
import { generateInventory } from '../scripts/generate-social-promotion.mjs';

function load(file, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => dependencies[name], Request, Response, Buffer, Intl, Date, ...globals });
  return exports;
}
const { promotionDigest } = load('lib/promotions/code.ts', { 'node:crypto': crypto });
const { parseActivationEligibility, protectionPresentation } = load('lib/activation-policy/presentation.ts');
const testCode = `EPX-${'AB'.repeat(24)}`; // Unit fixture only; never installed.

test('digest normalization and malformed input', () => {
  assert.equal(promotionDigest(` ${testCode.toLowerCase()} `), crypto.createHash('sha256').update(testCode).digest('hex'));
  for (const value of [null, {}, '', 'EPX-short', `${testCode}X`]) assert.equal(promotionDigest(value), null);
});

test('generator retries reuse all twenty private codes; DB manifest contains only hashes', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'epx-code-test-')));
  try {
    const first = generateInventory(directory);
    const bytes = readFileSync(first.file, 'utf8');
    const second = generateInventory(directory);
    assert.equal(readFileSync(second.file, 'utf8'), bytes);
    assert.equal(statSync(first.file).mode & 0o777, 0o600);
    const inventory = JSON.parse(bytes);
    const all = [...inventory.instagram, ...inventory.facebook];
    assert.equal(all.length, 20);
    assert.equal(new Set(all.map(row => row.code)).size, 20);
    const sql = readFileSync(first.manifest, 'utf8');
    for (const row of all) { assert(!sql.includes(row.code)); assert(sql.includes(promotionDigest(row.code))); }
  } finally { rmSync(directory, { recursive: true }); }
  assert.throws(() => generateInventory(new URL('../', import.meta.url).pathname), /outside Git/);
});

test('promotional presentation uses server expiry; never Lifetime or paid', () => {
  const row = { status: 'active', access_kind: 'promotion', evaluated_at: '2026-11-01T12:00:00Z', starts_at: null,
    preparation_ends_at: null, recovery_ends_at: null, promotion: { expires_at: '2027-11-01T12:00:00Z' } };
  assert.equal(protectionPresentation(parseActivationEligibility(row)).title, 'Promotional access');
  assert.match(protectionPresentation(row).deadline, /2027/);
  assert.equal(protectionPresentation(parseActivationEligibility({ ...row, status: 'promotion_expired' })).title, 'Promotional access expired');
  assert.throws(() => parseActivationEligibility({ ...row, promotion: null }));
  assert.throws(() => parseActivationEligibility({ ...row, status: 'promotion_expired', access_kind: 'subscription' }));
});

function handler({ user = { id: 'fixture-user', email_confirmed_at: '2026-01-01' }, enabled = true, result = 'success' } = {}) {
  const calls = [];
  const { POST } = load('app/api/promotions/redeem/route.ts', {
    '@/lib/promotions/code': { promotionDigest },
    '@/lib/guardians/server': {
      authenticateOwner: async () => user,
      guardianAdmin: () => ({ rpc: async (name, params) => { calls.push({ name, params }); return { data: { status: result }, error: null }; } }),
    },
  }, { process: { env: { SOCIAL_PROMOTION_ENABLED: enabled ? 'true' : 'false' } } });
  return { calls, POST };
}
const request = (body = JSON.stringify({ code: testCode })) => new Request('https://example.invalid/api/promotions/redeem', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});
test('authentication, verified email and deployment gate precede redemption', async () => {
  for (const [options, expected] of [[{ user: null }, 401], [{ user: { id: 'u' } }, 403], [{ enabled: false }, 503]]) {
    const h = handler(options);
    assert.equal((await h.POST(request())).status, expected);
    assert.equal(h.calls.length, 0);
  }
});
test('server sends only digest and authenticated owner; returns no code and no cache', async () => {
  const h = handler();
  const response = await h.POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'success' });
  assert.equal(h.calls[0].params.p_user_id, 'fixture-user');
  assert.equal(h.calls[0].params.p_digest, promotionDigest(testCode));
  assert(!JSON.stringify(h.calls).includes(testCode));
});
test('invalid small bodies consume DB rate budget; oversized bodies never reach DB', async () => {
  const h = handler({ result: 'invalid' });
  assert.equal((await h.POST(request('{invalid'))).status, 400);
  assert.equal(h.calls[0].params.p_digest, null);
  assert.equal((await h.POST(request('x'.repeat(513)))).status, 413);
  assert.equal(h.calls.length, 1);
});
test('all database outcomes have explicit HTTP mapping', async () => {
  for (const [result, status] of [['used', 409], ['ineligible', 403], ['rate_limited', 429], ['invalid', 400], ['unavailable', 503]]) {
    const response = await handler({ result }).POST(request());
    assert.equal(response.status, status);
    assert.equal((await response.json()).status, result);
  }
});
