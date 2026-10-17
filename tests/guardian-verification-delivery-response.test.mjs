import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const escalationId = '11111111-1111-4111-8111-111111111111';
const ownerId = '33333333-3333-4333-8333-333333333333';
const guardianId = '22222222-2222-4222-8222-222222222222';

// Tests execute the actual TS modules. Database state is a contract mock, not a
// substitute for executing migration 005 and racing its locks in PostgreSQL.
function harness(options = {}) {
  const state = { calls: [], sends: [], reservation: null, consumed: false, decisions: [], snapshotReads: 0 };
  const env = { NODE_ENV: 'production', GUARDIAN_VERIFICATION_EMAIL_ENABLED: 'true',
    GUARDIAN_VERIFICATION_RESPONSE_ENABLED: 'true', CONTINUITY_ENVIRONMENT: 'test',
    NEXT_PUBLIC_SITE_URL: 'https://test.eterpax.example', SUPABASE_URL: 'https://xkojvvppactsabnewezb.supabase.co',
    SUPABASE_SECRET_KEY: 'mock-service', RESEND_API_KEY: 'mock-resend',
    GUARDIAN_VERIFICATION_QUESTION: 'Synthetic test question',
    GUARDIAN_VERIFICATION_POSITIVE_LABEL: 'Synthetic positive choice', GUARDIAN_VERIFICATION_NEGATIVE_LABEL: 'Synthetic negative choice', ...options.env };
  const owners = options.owners ?? { [escalationId]: { id: ownerId, user_metadata: { firstName: 'Owner Alpha' } } };
  const reservations = new Map();
  const client = {
    auth: { admin: { async getUserById(id) {
      state.ownerReads ??= []; state.ownerReads.push(id);
      return { data: { user: options.wrongOwner ?? Object.values(owners).find(user => user?.id === id) ?? null },
        error: options.ownerError ? { message: 'mock error' } : null };
    } } },
    from(table) {
      assert(['guardian_escalation_participants','guardian_escalations'].includes(table)); state.snapshotReads++;
      const filters = [];
      const q = { select(columns) { assert.equal(columns, table === 'guardian_escalations' ? 'user_id' : 'name,email'); return q; },
        eq(k,v) { filters.push([k,v]); return q; }, abortSignal(signal) { assert(signal instanceof AbortSignal); return q; },
        async maybeSingle() {
          if (table === 'guardian_escalations') {
            assert.equal(filters[0][0], 'id'); assert.equal(filters.length, 1);
            const owner = owners[filters[0][1]];
            return { data: owner ? { user_id: owner.id } : null, error: options.escalationError ? { message: 'mock error' } : null };
          }
          assert.equal(filters[0][0], 'escalation_id');
          assert.deepEqual(filters[1], ['source_guardian_id',guardianId]);
          return { data: { name: 'Frozen Guardian', email: 'guardian@example.invalid' }, error: null };
        } };
      return q;
    },
    rpc(name,args) {
      state.calls.push({name,args});
      return { async abortSignal(signal) {
        assert(signal instanceof AbortSignal);
        if (name === 'reserve_guardian_verification_initial') {
          assert(!JSON.stringify(args).includes('#token='));
          assert.match(args.p_token_digest, /^\\x[0-9a-f]{64}$/);
          if (reservations.has(args.p_escalation_id)) return { data: [{ outcome:'emission_exists' }], error:null };
          state.reservation = args; reservations.set(args.p_escalation_id, args);
          return {data:[{outcome:'reserved',emission_id:args.p_emission_id,attempt_id:args.p_attempt_id,claim_id:args.p_claim_id,
            lease_expires_at:new Date(Date.now()+60000).toISOString(), token_expires_at:new Date(Date.now()+86400000).toISOString(),recipient_email:'guardian@example.invalid'}],error:null};
        }
        if (name === 'check_guardian_verification_dispatch') return {data:!options.cancelled,error:null};
        if (name === 'finalize_guardian_verification_attempt') {
          if (options.finalizeFailure) return { data:null,error:{message:'sensitive-provider-detail'} };
          state.finalized=args.p_outcome;
          return { data:args.p_outcome==='accepted'?'accepted_window_started':'uncertain',error:null };
        }
        if (name === 'submit_guardian_verification_response') {
          if (options.cancelled || state.consumed || state.finalized!=='accepted'
            || args.p_token_digest!==state.reservation?.p_token_digest) return {data:'unavailable',error:null};
          state.consumed=true; state.decisions.push(args.p_decision);
          return {data:'recorded',error:null};
        }
        throw new Error('Unexpected RPC '+name);
      } };
    },
  };
  const cache=new Map();
  function load(file) {
    if(cache.has(file))return cache.get(file);
    const exports={}; cache.set(file,exports);
    const compiled=ts.transpileModule(readFileSync(new URL(file,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(compiled,{exports,process:{env},Response,Request,URL,Buffer,Date,AbortSignal,
      require(name) {
        if(name==='server-only')return {};
        if(name.startsWith('node:'))return require(name);
        if(name.startsWith('./'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');
        if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
        if(name==='@supabase/supabase-js')return {createClient(url,key) {assert.equal(url,env.SUPABASE_URL);assert.equal(key,env.SUPABASE_SECRET_KEY);return client;}};
        if(name==='resend')return {Resend:class { constructor(key,opts){assert.equal(key,'mock-resend');assert.equal(opts.baseUrl,'https://api.resend.com');}
          emails={send:async(payload,opts)=>{state.sends.push({payload,opts});if(options.providerThrow)throw new Error('sensitive-provider-detail');return {data:{id:'synthetic-provider-id'},error:null};}}; }};
        throw new Error('Unmocked dependency '+name);
      },
    });
    return exports;
  }
  return {state,env,load,send:(input={})=>load('lib/continuity/guardian-verification-dispatch.ts').dispatchInitialGuardianVerification(client,{escalationId,guardianId,environment:'test',...input}),
    respond: (token, decision, extra={})=>load('lib/continuity/guardian-verification-response.ts').submitGuardianVerificationResponse(new Request(env.NEXT_PUBLIC_SITE_URL+'/api/guardian-verification/respond',{
      method:'POST',headers:{origin:extra.origin??env.NEXT_PUBLIC_SITE_URL,'content-type':'application/json'},body:extra.body??JSON.stringify({token,decision}),
    }))};
}

function sentToken(h) {
  const url=h.state.sends[0].payload.text.match(/https:\/\/[^\s]+/)[0];
  assert.equal(new URL(url).pathname,'/guardian-verification');
  assert.equal(new URL(url).search,'');
  return new URLSearchParams(new URL(url).hash.slice(1)).get('token');
}

test('disabled sending and response perform no database or provider operations',async()=>{
  const h=harness({env:{GUARDIAN_VERIFICATION_EMAIL_ENABLED:undefined,GUARDIAN_VERIFICATION_RESPONSE_ENABLED:undefined}});
  assert.equal((await h.send()).outcome,'disabled');
  assert.equal((await h.respond('bad','positive')).status,503);
  assert.equal(h.state.calls.length,0); assert.equal(h.state.sends.length,0);assert.equal(h.state.snapshotReads,0);
});

test('complete simulated flow reuses frozen recipient, hashes token, sends once, records explicit decision once',async()=>{
  const h=harness();
  assert.equal((await h.send()).outcome,'accepted_window_started');
  assert.equal((await h.send()).outcome,'emission_exists');assert.equal(h.state.sends.length,1);
  const {payload,opts}=h.state.sends[0];
  assert.equal(payload.subject,'ETERPAX — Guardian Verification Request');
  assert.equal(payload.to,'guardian@example.invalid');assert.equal(payload.from,'ETERPAX <hello@eterpax.com>');
  assert(payload.text.includes('A moment of trust. A request for your help.'));
  assert.equal(opts.idempotencyKey,`eterpax:test:guardian_verification_initial:${h.state.reservation.p_emission_id}`);
  const token=sentToken(h);assert.equal(Buffer.from(token,'base64url').length,32);
  assert.equal(h.state.reservation.p_token_digest,'\\x'+createHash('sha256').update(token).digest('hex'));
  assert.equal((await h.respond(token,'negative')).status,200);
  assert.deepEqual(h.state.decisions,['negative']);
  assert.equal((await h.respond(token,'positive')).status,409);
  assert.deepEqual(h.state.decisions,['negative']);
  assert(!JSON.stringify(h.state.calls).includes(token));
});

test('cancellation before send blocks provider; ambiguity/finalization errors never resend',async()=>{
  const cancelled=harness({cancelled:true});assert.equal((await cancelled.send()).outcome,'not_sent_blocked');assert.equal(cancelled.state.sends.length,0);
  for(const option of [{providerThrow:true},{finalizeFailure:true}]) {
    const h=harness(option);const result=await h.send();
    assert(['uncertain','finalization_uncertain'].includes(result.outcome));
    assert.equal((await h.send()).outcome,'emission_exists');assert.equal(h.state.sends.length,1);
    assert(!JSON.stringify(result).includes('sensitive'));
  }
});

test('response rejects invalid tokens, missing decisions, foreign origins and oversized bodies',async()=>{
  const h=harness();await h.send();const token=sentToken(h);
  for(const args of [['bad','positive'],[token,undefined],[token,'yes'],[token,'positive',{origin:'https://attacker.invalid'}],
    [token,'positive',{body:'x'.repeat(1025)}]])assert.notEqual((await h.respond(...args)).status,200);
  assert.equal(h.state.decisions.length,0);
  assert.equal((await h.respond(token,'positive')).status,200);
});

test('missing approved question blocks sending before reservation',async()=>{
  const h=harness({env:{GUARDIAN_VERIFICATION_QUESTION:undefined}});
  assert.equal((await h.send()).outcome,'configuration_error');
  assert.equal(h.state.snapshotReads,0);assert.equal(h.state.sends.length,0);assert.equal(h.state.calls.length,0);
});

test('GET renders explicit unselected choices; no token query, external scripts or auto voting',async()=>{
  const h=harness();const response=await h.load('app/guardian-verification/route.ts').GET();
  assert.equal(response.status,200); const html=await response.text();
  assert(html.includes("history.replaceState(null, '', location.pathname)"));
  assert(html.includes("form.addEventListener('submit'"));assert(!html.includes(' checked'));
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal(h.state.calls.length,0);
});


test('multiple owners use only the escalation owner identity, ignoring caller names and owner IDs', async () => {
  const otherEscalation = '44444444-4444-4444-8444-444444444444';
  const otherOwner = '55555555-5555-4555-8555-555555555555';
  const h = harness({ owners: {
    [escalationId]: { id: ownerId, user_metadata: { firstName: 'Owner Alpha' } },
    [otherEscalation]: { id: otherOwner, user_metadata: { display_name: 'Owner Beta' } },
  } });
  await h.send({ ownerName: 'FORGED', userId: otherOwner });
  await h.send({ escalationId: otherEscalation, ownerName: 'FORGED', userId: ownerId });
  assert.deepEqual(h.state.ownerReads, [ownerId, otherOwner]);
  assert.equal(h.state.sends.length, 2);
  assert(h.state.sends[0].payload.text.includes('Owner Alpha selected you'));
  assert(!h.state.sends[0].payload.text.includes('Owner Beta'));
  assert(h.state.sends[1].payload.text.includes('Owner Beta selected you'));
  assert(!h.state.sends[1].payload.text.includes('Owner Alpha'));
  for (const send of h.state.sends) assert(!send.payload.text.includes('FORGED'));
});

test('missing escalation, failed owner lookup or another owner returned blocks before reservation', async () => {
  for (const options of [{ owners: {} }, { escalationError: true }, { ownerError: true },
    { wrongOwner: { id: '66666666-6666-4666-8666-666666666666', user_metadata: { firstName: 'Wrong Owner' } } }]) {
    const h = harness(options);
    assert.equal((await h.send()).outcome, 'owner_unavailable');
    assert.equal(h.state.sends.length, 0); assert.equal(h.state.calls.length, 0);
  }
});

test('missing or unusable owner names fail closed without generic identity or email fallback', async () => {
  for (const user_metadata of [{}, {firstName: ''}, {firstName: 42}, {firstName: '\r\n\u0000'}]) {
    const h = harness({owners: {[escalationId]: {id: ownerId, user_metadata}}});
    assert.equal((await h.send()).outcome, 'owner_name_unavailable');
    assert.equal(h.state.sends.length, 0); assert.equal(h.state.calls.length, 0);
  }
});
