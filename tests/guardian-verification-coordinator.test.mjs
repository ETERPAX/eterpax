import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/continuity/server.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText;

function harness(flag, options = {}) {
  let now = 1000;
  const calls = [], queries = [];
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: `old-${String(i).padStart(2, '0')}`, created_at: i,
    status: 'waiting_for_responses', round: false,
  }));
  rows.unshift({ id: 'cancelled', created_at: -2, status: 'cancelled_owner_check_in', round: false },
    { id: 'has-round', created_at: -1, status: 'waiting_for_responses', round: true });
  const env = { CONTINUITY_SCHEDULER_ENABLED: 'true', CRON_SECRET: 'mock-cron',
    CONTINUITY_ENVIRONMENT: 'test', SUPABASE_URL: 'https://xkojvvppactsabnewezb.supabase.co',
    SUPABASE_SECRET_KEY: 'mock-service', ...(flag === undefined ? {} : { GUARDIAN_VERIFICATION_PREPARATION_ENABLED: flag }) };
  const admin = {
    from(table) {
      assert.equal(table, 'guardian_escalations');
      const steps = []; queries.push(steps);
      const query = {};
      for (const name of ['select', 'eq', 'is', 'order', 'limit']) {
        query[name] = (...args) => { steps.push([name, ...args]); return query; };
      }
      query.abortSignal = async signal => {
        assert(signal instanceof AbortSignal);
        if (options.selectionError) return { error: { code: 'PGRST200', message: 'sensitive' }, data: null };
        assert.deepEqual(JSON.parse(JSON.stringify(steps)), [
          ['select', 'id,guardian_verification_rounds(escalation_id)'],
          ['eq', 'status', 'waiting_for_responses'], ['is', 'guardian_verification_rounds', null],
          ['order', 'created_at', { ascending: true }], ['order', 'id', { ascending: true }], ['limit', 20],
        ]);
        return { error: null, data: rows.filter(r => r.status === 'waiting_for_responses' && !r.round)
          .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)).slice(0, 20) };
      };
      return query;
    },
    rpc(name, args) {
      calls.push({ name, args });
      if (name === 'process_continuity_engine') return { abortSignal: () => Promise.resolve({ data: [], error: null }) };
      assert.equal(name, 'prepare_guardian_verification');
      assert.deepEqual(Object.keys(args), ['p_escalation_id']);
      return { abortSignal: async signal => {
        assert(signal instanceof AbortSignal);
        const index = Number(args.p_escalation_id.split('-')[1]);
        if (options.abort) return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            now += 5000;
            reject(signal.reason);
          }, { once: true });
          queueMicrotask(() => abortController.abort(new DOMException('sensitive', 'AbortError')));
        });
        if (options.rpcFailure) return { data: null, ...options.rpcFailure };
        now += options.cost ?? 0;
        if (index === 4) return { data: null, error: { code: '23514', message: 'sensitive' }, status: 400 };
        if (index === 5) throw new Error('sensitive');
        const row = { escalation_id: args.p_escalation_id,
          outcome: ['prepared', 'already_prepared', 'ineligible', 'dispatch_expired'][index % 4] };
        if (index === 6) return { data: [], error: null };
        if (index === 7) return { data: [row, row], error: null };
        if (index === 8) row.outcome = 'unexpected';
        if (index === 9) row.escalation_id = 'wrong';
        return { data: [row], error: null };
      } };
    },
  };
  const abortController = new AbortController();
  const exports = {};
  vm.runInNewContext(compiled, { exports, process: { env }, Response, URL, setTimeout, clearTimeout, AbortController,
    AbortSignal: options.abort ? { timeout: () => abortController.signal } : AbortSignal,
    Date: class extends Date { static now() { return now; } },
    require(name) {
      if (name === 'server-only') return {};
      if (name === 'node:crypto') return require(name);
      if (name === '@supabase/supabase-js') return { createClient(url, key, config) {
        assert.equal(url, env.SUPABASE_URL); assert.equal(key, env.SUPABASE_SECRET_KEY);
        assert.equal(config.auth.persistSession, false); assert.equal(config.auth.autoRefreshToken, false);
        return admin;
      } };
      if (name === './email') return { deliverContinuityEmails: async client => {
        assert.equal(client, admin); calls.push({ name: 'existing-delivery' });
        if (options.deliveryError) throw new Error('sensitive');
        return { mocked: true };
      } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { calls, queries, run: async () => {
    const response = await exports.invokeContinuityEngine(new Request('https://example.test/api/cron/continuity', {
      headers: { authorization: 'Bearer mock-cron' },
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert(!JSON.stringify(body).includes('sensitive'));
    return body;
  } };
}

test('A: disabled flag preserves existing engine and delivery behavior', async () => {
  for (const flag of [undefined, 'false']) for (const deliveryError of [false, true]) {
    const h = harness(flag, { deliveryError });
    assert.deepEqual(await h.run(), { success: true, transitions: 0,
      delivery: deliveryError ? { success: false, code: 'DELIVERY_FAILED' } : { mocked: true } });
    assert.equal(h.queries.length, 0);
    assert.deepEqual(h.calls.map(c => c.name), ['process_continuity_engine', 'existing-delivery']);
  }
});

test('B: enabled mock coordinator recovers old work, bounds work and isolates results/errors', async () => {
  const h = harness('true');
  const body = await h.run();
  assert.equal(body.success, true);
  assert.equal(body.transitions, 0); // All selected candidates predate this invocation.
  assert.equal(body.preparation.attempted, 20);
  assert.equal(body.preparation.errors, 6);
  assert.equal(body.preparation.success, false);
  assert.deepEqual(body.preparation.error_categories, { configuration_or_permission: 0,
    rpc_rejected: 1, invalid_response: 4, transport_uncertain: 0, unexpected_error: 1 });
  assert.equal(body.preparation.remote_outcome_uncertain, 5);
  assert.deepEqual(body.preparation.outcomes, { prepared: 3, already_prepared: 3, ineligible: 4, dispatch_expired: 4 });
  const preparations = h.calls.filter(c => c.name === 'prepare_guardian_verification');
  assert.equal(preparations.length, 20);
  assert.equal(preparations[0].args.p_escalation_id, 'old-00');
  assert.equal(preparations.at(-1).args.p_escalation_id, 'old-19');
  assert.equal(h.calls.filter(c => c.name === 'process_continuity_engine').length, 1);
  assert.equal(h.calls.at(-1).name, 'existing-delivery');
  const timed = harness('true', { cost: 2500 });
  const timedBody = await timed.run();
  assert.equal(timedBody.preparation.attempted, 2);
  assert.equal(timedBody.preparation.budget_exhausted, true);
  const failed = harness('true', { selectionError: true });
  const failedBody = await failed.run();
  assert.equal(failedBody.success, true);
  assert.equal(failedBody.preparation.errors, 1);
  assert.equal(failedBody.preparation.attempted, 0);
  assert.equal(failedBody.preparation.error_categories.configuration_or_permission, 1);
  assert.equal(failedBody.preparation.remote_outcome_uncertain, 0);
  for (const [code, status, category, uncertain] of [
    ['42501', 403, 'configuration_or_permission', 0],
    ['23514', 400, 'rpc_rejected', 0],
    ['', 0, 'transport_uncertain', 20],
  ]) {
    const rpcFailed = harness('true', { rpcFailure: { error: { code, message: 'sensitive' }, status } });
    const result = await rpcFailed.run();
    assert.equal(result.success, true);
    assert.equal(result.preparation.success, false);
    assert.equal(result.preparation.error_categories[category], 20);
    assert.equal(result.preparation.remote_outcome_uncertain, uncertain);
    assert.equal(rpcFailed.calls.filter(c => c.name === 'process_continuity_engine').length, 1);
  }
  const aborted = harness('true', { abort: true });
  const abortResult = await aborted.run();
  assert.equal(abortResult.success, true);
  assert.equal(abortResult.preparation.success, false);
  assert.equal(abortResult.preparation.attempted, 1);
  assert.equal(abortResult.preparation.error_categories.transport_uncertain, 1);
  assert.equal(abortResult.preparation.remote_outcome_uncertain, 1);
  assert.equal(abortResult.preparation.budget_exhausted, true);
  assert.equal(aborted.calls.filter(c => c.name === 'process_continuity_engine').length, 1);
  assert.equal(aborted.calls.at(-1).name, 'existing-delivery');
  assert.deepEqual(failed.calls.map(c => c.name), ['process_continuity_engine', 'existing-delivery']);
});
