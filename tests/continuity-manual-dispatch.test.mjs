import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const owner = '11111111-1111-4111-8111-111111111111';
function load(file, env, mocks) {
  const exports = {};
  const code = require('typescript').transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, target: 7 },
  }).outputText;
  vm.runInNewContext(code, { exports, process: { env }, URL, Response, Date, AbortSignal, Buffer,
    setTimeout, clearTimeout, require: name => name === 'server-only' ? {} : mocks[name] ?? require(name) });
  return exports;
}
const env = { NODE_ENV: 'production', CONTINUITY_ENVIRONMENT: 'production',
  SUPABASE_URL: 'https://nfnkgvjehggrzlysvvhi.supabase.co', SUPABASE_SECRET_KEY: 'mock',
  NEXT_PUBLIC_SITE_URL: 'https://www.eterpax.com', RESEND_API_KEY: 'mock',
  CONTINUITY_MANUAL_DISPATCH_SECRET: 'x'.repeat(32), CONTINUITY_SCHEDULER_ENABLED: 'false' };
test('manual auth, method and input rejection; explicit administrative scope with scheduler disabled', async () => {
  const calls = [];
  const { dispatchManualCheckIn: run } = load('lib/continuity/manual-dispatch.ts', env, {
    '@supabase/supabase-js': { createClient: () => ({}) },
    './email': { deliverContinuityEmails: async (...args) => { calls.push(args); return { success: true }; } },
  });
  const request = (method, token, suffix = '', body) => new Request('https://www.eterpax.com/api/admin/continuity/dispatch' + suffix,
    { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body } : {}) });
  assert.equal((await run(request('GET'))).status, 405);
  assert.equal((await run(request('POST'))).status, 401);
  assert.equal((await run(request('POST', 'wrong'))).status, 401);
  assert.equal((await run(request('POST', env.CONTINUITY_MANUAL_DISPATCH_SECRET, '?owner=x'))).status, 400);
  assert.equal((await run(request('POST', env.CONTINUITY_MANUAL_DISPATCH_SECRET, '', '{}'))).status, 400);
  assert.equal(calls.length, 0);
  for (const body of [undefined, '{}', 'null', '[]', '{', JSON.stringify({userId:'bad'}), JSON.stringify({userId:owner,extra:true})]) {
    assert.equal((await run(request('POST', env.CONTINUITY_MANUAL_DISPATCH_SECRET, '', body))).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal((await run(request('POST', 'wrong', '', JSON.stringify({userId:owner})))).status, 401);
  assert.equal((await run(request('POST', env.CONTINUITY_MANUAL_DISPATCH_SECRET, '', JSON.stringify({userId:owner})))).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3].userId, owner);
  assert.equal(calls[0][3].limit, 2);
  const other = '22222222-2222-4222-8222-222222222222';
  assert.equal((await run(request('POST', env.CONTINUITY_MANUAL_DISPATCH_SECRET, '', JSON.stringify({userId:other})))).status, 200);
  assert.equal(calls[1][3].userId, other);
});
test('scoped claim has no global fallback; scheduler signature unchanged; invalid scopes fail before claim', async () => {
  const calls = [];
  const { deliverContinuityEmails: run } = load('lib/continuity/email.ts', env, {
    resend: { Resend: class {} },
  });
  let result = { data: [], error: null };
  const client = { rpc: async (...args) => { calls.push(args); return result; } };
  assert.equal((await run(client, 'production')).success, true);
  assert.equal(calls.pop()[0], 'claim_continuity_email_events');
  assert.equal((await run(client, 'production', undefined, { userId: owner, limit: 2 })).success, true);
  const scoped = calls.pop();
  assert.equal(scoped[0], 'claim_continuity_email_events_for_owner');
  assert.equal(scoped[1].p_user_id, owner);
  assert.equal(scoped[1].p_limit, 2);
  for (const limit of [0, 3, 1.5, NaN]) {
    assert.equal((await run(client, 'production', undefined, { userId: owner, limit })).code, 'INVALID_DELIVERY_SCOPE');
  }
  assert.equal(calls.length, 0);
  result = { data: null, error: { code: '42883' } };
  assert.equal((await run(client, 'production', undefined, { userId: owner, limit: 2 })).code, 'CLAIM_FAILED');
  assert.equal(calls.length, 1);
  result = { data: [{ user_id: 'another-owner' }], error: null };
  assert.equal((await run(client, 'production', undefined, { userId: owner, limit: 2 })).code, 'CLAIM_SCOPE_MISMATCH');
  result = { data: [{}, {}, {}], error: null };
  assert.equal((await run(client, 'production', undefined, { userId: owner, limit: 2 })).code, 'INVALID_CLAIM_RESPONSE');
  calls.length = 0;
  assert.equal((await run(client, 'production', Date.now(), { userId: owner, limit: 2 })).code, 'DELIVERY_BUDGET_EXHAUSTED');
  assert.equal(calls.length, 0);
  assert.equal((await run(client, 'production', Date.now() + 39000)).code, 'DELIVERY_BUDGET_EXHAUSTED');
  assert.equal(calls.length, 0);
});
test('scoped delivery preserves recipient, idempotency and claim-token finalization', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const claim = '00000000-0000-4000-8000-000000000002';
  const event = { id, user_id: owner, check_in_id: id, claim_token: claim,
    event_type: 'check_in_request', delivery_status: 'processing', attempt_count: 1,
    lease_expires_at: new Date(Date.now() + 600000).toISOString(),
    response_deadline_at: new Date(Date.now() + 3600000).toISOString() };
  const sends = [], updates = [];
  const { deliverContinuityEmails: run } = load('lib/continuity/email.ts', env, {
    resend: { Resend: class { emails = { send: async (...args) => {
      sends.push(args); return { error: null, data: { id } };
    } }; } },
  });
  let claimed = false;
  const client = {
    rpc: async () => { const data = claimed ? [] : [event]; claimed = true; return { data, error: null }; },
    auth: { admin: { getUserById: async () => ({ data: { user: { id: owner, email: 'owner@example.test' } }, error: null }) } },
    from(table) {
      let patch; const filters = [];
      const q = {
        update(value) { patch = value; return q; },
        select() { return q; }, eq(...args) { filters.push(args); return q; },
        maybeSingle() { return Promise.resolve({ error: null, data: table === 'check_ins'
          ? { user_id: owner, enabled: true, status: 'awaiting_response', response_deadline_at: event.response_deadline_at,
            next_check_in_at: null, missed_count: 0 } : event }); },
        abortSignal() { updates.push({ patch, filters }); return Promise.resolve({ data: [{ id }], error: null }); },
      }; return q;
    },
  };
  const scope = { userId: owner, limit: 2 };
  const concurrent = await Promise.all([run(client, 'production', undefined, scope), run(client, 'production', undefined, scope)]);
  assert.equal(concurrent.reduce((sum, result) => sum + result.counts.sent, 0), 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][0].to, 'owner@example.test');
  assert.equal(sends[0][0].from, 'ETERPAX <hello@eterpax.com>');
  assert.equal(sends[0][1].idempotencyKey, `eterpax:production:check_in_request:${id}`);
  assert.equal(updates[0].patch.delivery_status, 'sent');
  assert(updates[0].filters.some(([key, value]) => key === 'claim_token' && value === claim));
});

test('owner A dispatch leaves owner B pending; each owner is claimed separately', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  const events = [owner, other].map((user_id, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i+1}`, user_id,
    check_in_id: `00000000-0000-4000-8000-00000000000${i+1}`,
    claim_token: '00000000-0000-4000-8000-000000000003',
    event_type:'check_in_request', delivery_status:'pending', attempt_count:1,
    lease_expires_at:new Date(Date.now()+600000).toISOString(),
    response_deadline_at:new Date(Date.now()+3600000).toISOString(),
  }));
  const sent=[], claims=[];
  const { deliverContinuityEmails: run } = load('lib/continuity/email.ts', env, {
    resend: { Resend: class { emails={send:async message=>{sent.push(message.to);return {error:null,data:{id:'33333333-3333-4333-8333-333333333333'}};}}; } },
  });
  const client={
    rpc:async(name,args)=>{
      assert.equal(name,'claim_continuity_email_events_for_owner');claims.push(args.p_user_id);
      const data=events.filter(e=>e.user_id===args.p_user_id && e.delivery_status==='pending');
      data.forEach(e=>{e.delivery_status='processing';});return {data,error:null};
    },
    auth:{admin:{getUserById:async id=>({data:{user:{id,email:id===owner?'a@example.test':'b@example.test'}},error:null})}},
    from(table){let patch;const filters=[];const q={
      select(){return q;},eq(k,v){filters.push([k,v]);return q;},update(p){patch=p;return q;},
      maybeSingle(){const id=filters.find(([k])=>k==='id')?.[1];const e=events.find(e=>e.id===id);assert(e);
        return Promise.resolve({error:null,data:table==='check_ins'?{user_id:e.user_id,enabled:true,status:'awaiting_response',response_deadline_at:e.response_deadline_at,next_check_in_at:null,missed_count:0}:e});},
      abortSignal(){const e=events.find(e=>filters.every(([k,v])=>e[k]===v));assert(e);Object.assign(e,patch);return Promise.resolve({data:[{id:e.id}],error:null});},
    };return q;},
  };
  const untouched=JSON.stringify(events[1]);
  assert.equal((await run(client,'production',undefined,{userId:owner,limit:2})).counts.sent,1);
  assert.equal(JSON.stringify(events[1]),untouched);assert.deepEqual(sent,['a@example.test']);
  assert.equal((await run(client,'production',undefined,{userId:owner,limit:2})).counts.sent,0);
  assert.equal((await run(client,'production',undefined,{userId:other,limit:2})).counts.sent,1);
  assert.deepEqual(sent,['a@example.test','b@example.test']);assert.deepEqual(claims,[owner,owner,other]);
});
