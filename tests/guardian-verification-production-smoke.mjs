// Only the built local HTTP application. No database, provider, votes or sends.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const config = JSON.parse(readFileSync(new URL('../deployment/guardian-verification.production.json', import.meta.url)));
const port = 3417;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: new URL('..', import.meta.url),
  env: { PATH: process.env.PATH, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    ...config.vercel.variables, NEXT_PUBLIC_SITE_URL: config.vercel.canonicalOrigin, SUPABASE_SECRET_KEY: '', RESEND_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(output);
    if (output.includes('Ready in')) { ready = true; break; }
    await sleep(200);
  }
  assert.ok(ready, 'production server ready');
  const page = await fetch(`${base}/guardian-verification`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.ok(page.headers.get('content-security-policy').includes("connect-src 'self'"));
  const html = await page.text();
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.ok(html.includes('value="positive"') && html.includes('value="negative"'));
  const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  for (const key of ['GUARDIAN_VERIFICATION_QUESTION','GUARDIAN_VERIFICATION_POSITIVE_LABEL','GUARDIAN_VERIFICATION_NEGATIVE_LABEL']) {
    assert.ok(html.includes(escape(config.vercel.variables[key])), `approved copy: ${key}`);
  }
  assert.ok(html.includes('history.replaceState'));
  assert.ok(html.includes("location.hash"));
  const post = await fetch(`${base}/api/guardian-verification/respond`, {method:'POST', headers:{origin:config.vercel.canonicalOrigin,'content-type':'application/json'},body:'{}'});
  assert.equal(post.status, 400);
  assert.equal((await fetch(`${base}/api/guardian-verification/respond`)).status, 405);
  assert.equal((await fetch(`${base}/api/cron/continuity`)).status, 503);
  console.log('PASS: built production page, approved choices, response route, disabled cron. No SQL or email.');
} finally {
  server.kill('SIGTERM');
}
