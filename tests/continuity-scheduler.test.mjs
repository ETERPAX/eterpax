import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const env = { NODE_ENV: 'production', CONTINUITY_ENVIRONMENT: 'production',
  SUPABASE_URL: 'https://nfnkgvjehggrzlysvvhi.supabase.co', SUPABASE_SECRET_KEY: 'mock',
  NEXT_PUBLIC_SITE_URL: 'https://www.eterpax.com', RESEND_API_KEY: 'mock',
  CONTINUITY_MANUAL_DISPATCH_SECRET: 'x'.repeat(32), CONTINUITY_SCHEDULER_ENABLED: 'false' };

test('scheduler disabled/auth rejected before RPC; global dispatch after slow engine, no retries', async () => {
  for (const scenario of ['disabled', 'unauthorized', 'slow', 'unknown', 'timeout', 'mail_failure', 'oversized']) {
    let now = 0; const calls = []; const logs = [];
    const config = { ...env, CONTINUITY_SCHEDULER_ENABLED: scenario === 'disabled' ? 'false' : 'true', CRON_SECRET: 'test-secret' };
    const source = require('typescript').transpileModule(readFileSync('lib/continuity/server.ts','utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText;
    const exports = {};
    vm.runInNewContext(source, { exports, process: { env: config }, URL, Response, AbortController,
      setTimeout: scenario === 'timeout' ? fn => { queueMicrotask(fn); return 1; } : setTimeout, clearTimeout, Date: class extends Date { static now() { return now; } },
      console: { info: value => logs.push(value) },
      require(name) {
        if (name === 'server-only') return {};
        if (name === 'node:crypto') return require(name);
        if (name === '@supabase/supabase-js') return { createClient: () => ({ rpc: name => {
          calls.push(name);
          return { abortSignal: async () => {
            if (scenario === 'timeout') return new Promise(() => {});
            now += 9000;
            if (scenario === 'unknown') throw new Error('private-error');
            return { data: scenario === 'oversized' ? Array(101).fill({}) : [], error: null };
          } };
        } }) };
        if (name === './email') return { deliverContinuityEmails: async (...args) => {
          calls.push('delivery'); assert.equal(args.length, 3); assert.equal(args[2] - now, 45000);
          if (scenario === 'mail_failure') throw new Error('private-error');
          return { success: true, counts: {} };
        } };
        throw new Error('unexpected dependency');
      },
    });
    const response = await exports.invokeContinuityEngine(new Request('https://example.test/api/cron/continuity', {
      headers: { authorization: scenario === 'unauthorized' ? 'Bearer bad' : 'Bearer test-secret' },
    }));
    if (['disabled','unauthorized'].includes(scenario)) assert.equal(calls.length,0);
    else {
      assert.equal(calls.filter(x => x === 'process_continuity_engine').length,1);
      if (['unknown','timeout','oversized'].includes(scenario)) {
        assert.equal(response.status,502); assert(!calls.includes('delivery'));
        assert.equal((await response.json()).code,'ENGINE_OUTCOME_UNKNOWN');
      } else assert.equal(response.status,200);
    }
    assert(!logs.join('').includes('private-error'));
  }
});
