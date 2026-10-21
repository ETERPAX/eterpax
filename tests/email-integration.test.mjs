import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { emailFixtures } from './helpers/email-fixtures.mjs';
const base = '2cb3855e845d388514c9fe14968ecf405d31da95';
const read = file => readFileSync(file, 'utf8');
const original = file => execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });

test('merged preview registry renders both approved emails with one institutional frame each', () => {
  const emails = emailFixtures();
  assert.equal(Object.keys(emails).length, 6);
  assert.equal(emails.welcome.subject, 'Welcome to ETERPAX');
  assert.equal(emails['guardian-invitation'].subject, "You've Been Chosen as an ETERPAX Guardian");
  for (const name of ['welcome', 'guardian-invitation']) {
    assert.equal((emails[name].html.match(/<!doctype html>/g) ?? []).length, 1);
    assert.equal(read(`previews/emails/${name}.html`), emails[name].html);
    assert(read('previews/emails/index.html').includes(`href="${name}.html"`));
  }
  assert(!/<a\b|href=|<button\b/i.test(emails['guardian-invitation'].html));
  assert.match(emails.welcome.html, /href="https:\/\/www.eterpax.com\/dashboard"/);
});
test('welcome cron is additive and existing schedules remain byte-for-byte equivalent as objects', () => {
  const before = JSON.parse(original('vercel.json'));
  const after = JSON.parse(read('vercel.json'));
  assert.deepEqual(after.crons.filter(c => c.path !== '/api/cron/welcome-email'), before.crons);
  assert.deepEqual(after.crons.filter(c => c.path === '/api/cron/welcome-email'), [{ path: '/api/cron/welcome-email', schedule: '* * * * *' }]);
});
test('protected business flows and shared presentation are unchanged from Production', () => {
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', base], { encoding: 'utf8' }).trim().split('\n');
  const protectedPaths = paths.filter(p => p.startsWith('lib/continuity/') || p.startsWith('lib/recipient-delivery/')
    || p.startsWith('app/api/stripe') || p.startsWith('app/api/checkout/') || p.startsWith('app/api/cron/continuity/')
    || p.startsWith('app/api/cron/recipient-delivery/') || p.startsWith('app/api/guardians/')
    || p.startsWith('supabase/migrations/') || p === 'lib/email/presentation.ts');
  for (const file of protectedPaths) assert.equal(read(file), original(file), file);
  const createAccount = original('components/auth/CreateAccountView.tsx')
    .replace('const { data, error: signUpError }', 'const { error: signUpError }')
    .replace('  console.log("ACCOUNT CREATED:", data.user);\n\n', '');
  assert.equal(read('components/auth/CreateAccountView.tsx'), createAccount);
});
