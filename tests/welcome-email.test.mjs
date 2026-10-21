import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const owner = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
function load(file, env = {}, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText;
  vm.runInNewContext(source, { exports, process: { env }, Date, URL, Response, AbortSignal,
    console: { log() { assert.fail('No logs permitted'); }, error() { assert.fail('No logs permitted'); } },
    require(name) {
      if (name === 'server-only') return {};
      if (name in dependencies) return dependencies[name];
      if (name.startsWith('node:')) return require(name);
      if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts', env, dependencies);
      if (name === 'resend' || name === '@supabase/supabase-js') return {};
      throw Error('Unexpected module');
    },
  });
  return exports;
}
const { welcomeEmail } = load('lib/welcome/email.ts');
test('approved copy, safe fixed CTA, institutional frame and escaped first name', () => {
  const result = welcomeEmail('Alex');
  assert.equal(result.subject, 'Welcome to ETERPAX');
  assert.equal(result.text, [
    'Dear Alex,', 'Welcome to ETERPAX.', "You've taken the first step toward preserving what matters most.",
    'ETERPAX gives you a private space to create meaningful messages, choose the people who matter to you, and establish a continuity plan for the future.',
    'Your account is ready.', 'GO TO MY DASHBOARD\nhttps://www.eterpax.com/dashboard',
    'Take your time. Your story is yours to tell.', 'Confidence is designed. Trust is earned. Continuity is intentional.', 'The ETERPAX Team',
  ].join('\n\n'));
  for (const value of ['#f4f3ef', '#071B2E', 'max-width:600px', 'Arial', '>GO TO MY DASHBOARD</a>']) assert(result.html.includes(value));
  assert.equal(result.html.match(/href="[^"]+"/g).join(''), 'href="https://www.eterpax.com/dashboard"');
  const malicious = welcomeEmail('<img src=x onerror=alert(1)>\r\nMorgan');
  assert(!malicious.html.includes('<img')); assert(malicious.html.includes('&lt;img'));
  assert(!malicious.text.includes('\r'));
  assert.throws(() => welcomeEmail(' \n\u0000'));
});
function harness({ mode = 'success', rows = [1, 2].map(n => ({ user_id: owner(n), claim_token: owner(n + 10), email: `owner${n}@example.invalid`, first_name: `Owner ${n}` })) } = {}) {
  const queue = [...rows], sends = [], finishes = [], calls = [];
  const client = { rpc(name, args) { calls.push(name); return { async abortSignal(signal) {
    assert(signal instanceof AbortSignal);
    if (name === 'claim_welcome_email') {
      if (mode === 'claim-error') return { data: null, error: {} };
      return { data: queue.length ? [queue.shift()] : [], error: null };
    }
    assert.equal(name, 'finish_welcome_email'); finishes.push(args);
    return { data: mode !== 'finish-error', error: null };
  } }; } };
  const resend = { emails: { async send(payload, options) {
    sends.push({ payload, options });
    if (mode === 'throw') throw Error('PRIVATE TOKEN AND EMAIL');
    if (mode === 'reject') return { data: null, error: { message: 'PRIVATE TOKEN AND EMAIL' } };
    if (mode === 'empty') return { data: null, error: null };
    return { data: { id: 'synthetic-provider-id' }, error: null };
  } } };
  const run = () => load('lib/welcome/server.ts').sendPendingWelcomes(client, resend, Date.now() + 55_000);
  return { run, sends, finishes, calls, client, resend };
}
test('multiple accounts get their own name/address and stable per-account idempotency key', async () => {
  const h = harness(); const counts = await h.run();
  assert.equal(counts.accepted, 2);
  h.sends.forEach(({ payload, options }, index) => {
    assert.equal(payload.to, `owner${index + 1}@example.invalid`);
    assert.equal(payload.from, 'ETERPAX <hello@eterpax.com>');
    assert(payload.text.startsWith(`Dear Owner ${index + 1},`));
    assert.equal(options.idempotencyKey, `eterpax:welcome:${owner(index + 1)}`);
    assert.equal(h.finishes[index].p_user_id, owner(index + 1));
  });
  await h.run(); assert.equal(h.sends.length, 2);
});
test('concurrent workers cannot send a claimed queue item twice', async () => {
  const h = harness(); await Promise.all([h.run(), h.run()]);
  assert.equal(h.sends.length, 2); assert.equal(new Set(h.sends.map(x => x.payload.to)).size, 2);
});
test('ambiguous outcomes never trigger a second provider attempt or expose raw errors', async () => {
  for (const mode of ['throw', 'reject', 'empty', 'finish-error']) {
    const h = harness({ mode }); const counts = await h.run(); await h.run();
    assert.equal(h.sends.length, 2);
    if (mode === 'finish-error') assert.equal(counts.error, 2);
    else assert(h.finishes.every(x => x.p_status === 'uncertain'));
    assert(!JSON.stringify(counts).includes('PRIVATE'));
  }
});
test('invalid recipient/name, unavailable DB or exhausted budget cannot send', async () => {
  for (const row of [{ email: 'bad\r\n@example.invalid', first_name: 'Alex' }, { email: 'a@example.invalid', first_name: '\n\u0000' }]) {
    const h = harness({ rows: [{ user_id: owner(1), claim_token: owner(2), ...row }] });
    assert.equal((await h.run()).invalid, 1); assert.equal(h.sends.length, 0);
  }
  const h = harness({ mode: 'claim-error' }); assert.equal((await h.run()).error, 1); assert.equal(h.sends.length, 0);
  const idle = harness(); await load('lib/welcome/server.ts').sendPendingWelcomes(idle.client, idle.resend, Date.now());
  assert.equal(idle.calls.length, 0);
});
test('cron authenticates before clients, refuses development and pins provider origin', async () => {
  const env = { NODE_ENV: 'production', CRON_SECRET: 'synthetic-cron-secret', RESEND_API_KEY: 'synthetic-provider', SUPABASE_SECRET_KEY: 'synthetic-service', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' };
  let creations = 0;
  const h = harness({ rows: [] });
  const deps = { '@supabase/supabase-js': { createClient() { creations++; return h.client; } }, resend: { Resend: class { constructor(key, options) { assert.equal(key, env.RESEND_API_KEY); assert.equal(options.baseUrl, 'https://api.resend.com'); } } } };
  const request = (token, suffix = '') => new Request('https://www.eterpax.com/api/cron/welcome-email' + suffix, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const run = load('lib/welcome/server.ts', env, deps).runWelcomeEmails;
  assert.equal((await run(request())).status, 401);
  assert.equal((await run(request('wrong'))).status, 401);
  assert.equal((await run(request(env.CRON_SECRET, '?user=another'))).status, 400);
  assert.equal((await load('lib/welcome/server.ts', { ...env, NODE_ENV: 'development' }, deps).runWelcomeEmails(request(env.CRON_SECRET))).status, 503);
  assert.equal(creations, 0);
  assert.equal((await run(request(env.CRON_SECRET))).status, 200); assert.equal(creations, 1);
});
test('Create Account navigation is independent of email; no PII console log remains', () => {
  const source = readFileSync(new URL('components/auth/CreateAccountView.tsx', root), 'utf8');
  assert.equal((source.match(/window.location.href = "\/dashboard"/g) ?? []).length, 2);
  assert(!source.includes('console.log')); assert(!source.includes('welcome')); assert(!source.includes('resend'));
});
