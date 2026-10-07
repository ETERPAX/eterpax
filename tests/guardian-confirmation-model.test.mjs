import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const iso = seconds => new Date(seconds * 1000).toISOString();

// No real Stripe, Supabase or Resend. SQL behavior below is a model of its
// contract, not proof of execution/locking in PostgreSQL. Static SQL checks are
// separate; deployed schema/RPC compatibility must be validated before rollout.
function harness() {
  let sequence = 0;
  const id = () => `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}`;
  const state = { guardians: [], notifications: [], sends: [], rpc: [], retrievals: [], active: false,
    activation: null, event: null, subscription: null, frequency: 75, nextCheckIn: null, failProvider: false, logs: [], providerResult: undefined, providerException: undefined,
    checkIn: { frequency_days: 75, enabled: false, status: 'scheduled', missed_count: 0,
      last_check_in_at: null, response_deadline_at: null, next_check_in_at: iso(1600000000),
      awaiting_plan_activation: true, created_at: iso(1500000000), updated_at: iso(1600000000) } };
  const enqueue = (rows, explicitSelection = false) => {
    if (!state.active || !state.activation) return;
    for (const row of rows) if (typeof row.email === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(row.email)
      && !state.notifications.some(n => (!explicitSelection && n.guardian_id === row.id && n.status === 'legacy_suppressed') || n.email === row.email)) {
      state.notifications.push({ id: id(), user_id: owner, guardian_id: row.id, email: row.email, status: 'queued' });
    }
  };
  const admin = {
    auth: { admin: { async getUserById(userId) { return { data: { user: { id: userId, user_metadata: { firstName: '<b>Alex</b>' } } }, error: null }; } } },
    from(table) {
      assert(['guardians','guardian_notifications'].includes(table));
      const filters = []; let changes;
      const query = {
        update(value) { changes = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        select() {
          if (!changes) return query;
          const rows = state.notifications.filter(row => filters.every(([key,value]) => row[key] === value));
          for (const row of rows) Object.assign(row, changes);
          return Promise.resolve({ data: rows.map(row => ({ id: row.id })), error: null });
        },
        async order() { return { data: state.guardians.filter(row => filters.every(([key,value]) => row[key] === value)), error: null }; },
      };
      return query;
    },
    async rpc(name, args) {
      state.rpc.push({ name, args });
      if (name === 'save_guardian_selection') {
        assert.equal(args.p_user_id, owner);
        const currentIds = state.guardians.map(g => g.id).sort();
        if (JSON.stringify(currentIds) !== JSON.stringify([...args.p_existing_ids].sort())) return { error: {} };
        const newRows = []; const rows = [];
        for (const input of args.p_guardians) {
          let row = input.id ? state.guardians.find(g => g.id === input.id && g.user_id === owner) : null;
          if (input.id && !row) return { error: {} };
          if (!row) { row = { ...input, id: id(), user_id: owner }; newRows.push(row); }
          else {
            if (row.email?.trim().toLowerCase() !== input.email) newRows.push(row);
            Object.assign(row, input);
          }
          rows.push(row);
        }
        state.guardians = rows;
        enqueue(newRows, true);
        return { data: { guardians: rows, active: state.active && !!state.activation }, error: null };
      }
      if (name === 'sync_guardian_plan_subscription') {
        state.active = args.p_subscription.status === 'active';
        if (args.p_activated_at && !state.activation) {
          state.activation = args.p_activated_at;
          const c = state.checkIn;
          if (c?.awaiting_plan_activation && !c.enabled && c.status === 'scheduled'
            && c.missed_count === 0 && c.response_deadline_at === null) {
            state.nextCheckIn = new Date(Date.parse(state.activation) + c.frequency_days * 86400000).toISOString();
            c.enabled = true; c.awaiting_plan_activation = false; c.next_check_in_at = state.nextCheckIn;
          }
          enqueue(state.guardians);
        }
        return { error: null };
      }
      assert.equal(name, 'claim_guardian_notifications');
      if (!state.active) return { data: [], error: null };
      const claimed = [];
      for (const row of state.notifications) if (row.status === 'queued') {
        if (!state.guardians.some(g => g.id === row.guardian_id && g.email === row.email)) row.status = 'cancelled';
        else { row.status = 'sending'; claimed.push({ ...row }); }
      }
      return { data: claimed, error: null };
    },
  };
  const env = { NODE_ENV: 'production', RESEND_API_KEY: 'mock-email-key', STRIPE_SECRET_KEY: 'mock-stripe', STRIPE_WEBHOOK_SECRET: 'mock-webhook',
    NEXT_PUBLIC_SUPABASE_URL: 'https://mock.example', SUPABASE_SECRET_KEY: 'mock-secret', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'mock-public' };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInNewContext(compiled, { exports, console: { error: (...args) => state.logs.push(args) }, process: { env }, Response, Request, Date, AbortSignal,
      require(name) {
        if (name === 'server-only') return {};
        if (name === '@/lib/guardians/server') return load('lib/guardians/server.ts');
        if (name === '@supabase/supabase-js') return { createClient(_url, key) {
          if (key === env.SUPABASE_SECRET_KEY) return admin;
          return { auth: { async getUser(token) { return { data: { user: token === 'valid' ? { id: owner } : null }, error: token === 'valid' ? null : {} }; } } };
        } };
        if (name === 'resend') return { Resend: class {
          emails = { send: async (email, options) => {
            state.sends.push({ email, options });
            if (state.providerException !== undefined) throw state.providerException;
            if (state.providerResult !== undefined) return state.providerResult;
            if (state.failProvider) throw new Error('Unknown network result');
            return { data: { id: 'mock-provider-id' }, error: null };
          } };
        } };
        if (name === 'stripe') return class {
          webhooks = { constructEvent(_body, signature) { if (signature !== 'good') throw new Error('Rejected'); return state.event; } };
          subscriptions = { retrieve: async (subscriptionId, options) => { state.retrievals.push({ subscriptionId, options }); return state.subscription; } };
        };
        throw new Error(`Unexpected dependency: ${name}`);
      },
    }, { filename: file });
    cache.set(file, exports); return exports;
  }
  return { state, env, admin, helpers: load('lib/guardians/server.ts'), api: load('app/api/guardians/route.ts'), webhook: load('app/api/stripe-webhook/route.ts'), retired: load('app/api/guardian-confirm/route.ts') };
}
const input = n => ({ id: null, name: `Guardian ${n}`, email: `g${n}@example.com`, relationship: 'Friend' });
function save(h, rows, authorization = 'Bearer valid', extra = {}) {
  return h.api.POST(new Request('https://eterpax.example/api/guardians', { method: 'POST', headers: { authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ existingIds: h.state.guardians.map(g => g.id), guardians: rows.map(({id,name,email,relationship}) => ({id,name,email,relationship})), ...extra }) }));
}
function existing(h) { return h.state.guardians.map(g => ({ ...g })); }
function stripeState(h, status = 'active', paid = true, paidAt = 1700000000) {
  h.state.subscription = { id: 'sub_1', customer: 'cus_1', status, metadata: { user_id: owner }, cancel_at_period_end: false, canceled_at: null,
    latest_invoice: { status: paid ? 'paid' : 'open', status_transitions: { paid_at: paid ? paidAt : null } },
    items: { data: [{ price: { id: 'price_1' }, current_period_start: paidAt, current_period_end: paidAt + 86400000 }] } };
  h.state.event = { type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'stale-ignored' } } };
}
function webhook(h, signature = 'good') {
  return h.webhook.POST(new Request('https://eterpax.example/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: '{}' }));
}

test('unpaid save permits two Guardians, sends nothing and reports unpaid state', async () => {
  const h = harness(); const result = await (await save(h,[input(1),input(2)])).json();
  assert.equal(result.active, false); assert.equal(result.guardians.length, 2);
  assert.equal(h.state.sends.length, 0); assert.equal(h.state.notifications.length, 0); assert.equal(h.state.nextCheckIn, null);
});

test('authenticated save rejects spoofed ownership, paid state, status and invalid counts', async () => {
  for (const auth of ['', 'Basic abc', 'Bearer invalid']) {
    const h = harness(); assert.equal((await save(h,[input(1),input(2)],auth)).status,401); assert.equal(h.state.rpc.length,0);
  }
  const h = harness();
  assert.equal((await save(h,[input(1)],'Bearer valid')).status,400);
  assert.equal((await save(h,Array.from({length:7},(_,n)=>input(n)))).status,400);
  assert.equal((await save(h,[input(1),input(2)],'Bearer valid',{active:true})).status,400);
  assert.equal(h.state.rpc.length,0);
});

test('signed active-and-paid Stripe state activates; one initial email per Guardian', async () => {
  const h = harness(); await save(h,[input(1),input(2),input(3)]); stripeState(h);
  assert.equal((await webhook(h)).status,200); assert.equal(h.state.sends.length,3);
  assert.equal(h.state.activation,iso(1700000000));
  assert.equal(h.state.nextCheckIn,iso(1700000000+75*86400));
  assert.equal(h.state.retrievals.length,1); assert.equal(h.state.notifications.filter(n=>n.status==='sent').length,3);
  assert.equal(h.state.rpc.find(r=>r.name==='sync_guardian_plan_subscription').args.p_subscription.user_id,owner);
});

test('webhook retry and renewal do not resend or restart the countdown', async () => {
  const h=harness(); await save(h,[input(1),input(2)]); stripeState(h); await webhook(h);
  const start=h.state.nextCheckIn; await webhook(h); stripeState(h,'active',true,1703000000); await webhook(h);
  assert.equal(h.state.sends.length,2); assert.equal(h.state.nextCheckIn,start);
});

test('signature failure, unpaid active state and trial do not activate/send', async () => {
  const h=harness(); await save(h,[input(1),input(2)]); stripeState(h);
  assert.equal((await webhook(h,'bad')).status,400); assert.equal(h.state.retrievals.length,0);
  stripeState(h,'active',false); await webhook(h);
  stripeState(h,'trialing',true); await webhook(h);
  assert.equal(h.state.activation,null); assert.equal(h.state.sends.length,0); assert.equal(h.state.nextCheckIn,null);
});

test('invoice.paid and asynchronous checkout use current subscription state, not redirect', async () => {
  for(const type of ['invoice.paid','checkout.session.async_payment_succeeded']) {
    const h=harness(); await save(h,[input(1),input(2)]); stripeState(h);
    h.state.event={type,data:{object:type==='invoice.paid'?{parent:{subscription_details:{subscription:'sub_1'}}}:{subscription:'sub_1',metadata:{user_id:owner}}}};
    assert.equal((await webhook(h)).status,200); assert.equal(h.state.sends.length,2);
  }
});

test('active subscriber new Guardian notifies only new one; edits/removal do not resend', async () => {
  const h=harness(); await save(h,[input(1),input(2)]); stripeState(h); await webhook(h);
  const firstIds=h.state.guardians.map(g=>g.id);
  await save(h,[...existing(h),input(3)]); assert.equal(h.state.sends.length,3);
  const rows=existing(h); rows[0].name='Updated name'; rows[0].relationship='Sibling';
  await save(h,rows); assert.equal(h.state.sends.length,3); assert.deepEqual(h.state.guardians.slice(0,2).map(g=>g.id),firstIds);
  await save(h,existing(h).slice(0,2)); assert.equal(h.state.sends.length,3);
});

test('removing/re-adding same address cannot evade durable notification history', async () => {
  const h=harness(); await save(h,[input(1),input(2),input(3)]); stripeState(h); await webhook(h);
  await save(h,existing(h).slice(0,2)); await save(h,[...existing(h),input(3)]);
  assert.equal(h.state.sends.length,3);
});

test('ambiguous provider outcome is not retried on webhook retry or ordinary save', async () => {
  const h=harness(); await save(h,[input(1),input(2)]); stripeState(h); h.state.failProvider=true;
  assert.equal((await webhook(h)).status,503); assert.equal(h.state.sends.length,2);
  assert(h.state.notifications.every(n=>n.status==='uncertain'));
  h.state.failProvider=false; await webhook(h); await save(h,existing(h)); assert.equal(h.state.sends.length,2);
});

test('overlapping workers claim at most once in the mocked atomic contract', async () => {
  const h=harness(); await save(h,[input(1),input(2)]); h.state.active=true; h.state.activation=iso(1700000000);
  h.state.notifications=h.state.guardians.map((g,n)=>({id:`notification-${n}`,user_id:owner,guardian_id:g.id,email:g.email,status:'queued'}));
  await Promise.all([h.helpers.sendGuardianConfirmations(h.admin,owner),h.helpers.sendGuardianConfirmations(h.admin,owner)]);
  assert.equal(h.state.sends.length,2);
});

test('neutral plain-text email has no links, buttons, tokens, or private content reads', () => {
  const h=harness(); const email=h.helpers.confirmationEmail('<script>alert(1)</script>\nName');
  assert.equal(email.html,undefined); assert(!email.subject.includes('<script>'));
  assert.match(email.text,/there is nothing you need to do/); assert.match(email.text,/their/);
  assert(!/https?:|Accept|Decline|token=/.test(email.text));
  assert.match(h.helpers.confirmationEmail(undefined).text,/An ETERPAX member/);
  assert(!/from\(["'](?:messages|message_photos|message_videos|message_documents)["']\)/.test(read('lib/guardians/server.ts')));
});

test('old Guardian response endpoint has no state-changing behavior', async () => {
  const h=harness(); for(const method of ['GET','POST']) {
    const response=await h.retired[method](); assert.equal(response.status,410); assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal(h.state.rpc.length,0); assert.equal(h.state.sends.length,0);
});

test('owner screens preserve editing, show unpaid notice and have no invitation UI', () => {
  for(const file of ['app/(auth)/guardians/page.tsx','app/(auth)/your-guardians/page.tsx']) {
    const source=read(file);
    assert.match(source,/Pencil/); assert.match(source,/Add another Guardian/); assert.match(source,/if \(!result.active\)/);
    assert.match(source,/setShowSavedNotice\(true\)/); assert.match(source,/selected.length < 2 \|\| selected.length > 6/);
    assert(!/invitation|guardianStatus|Accept|Decline|Expired/.test(source));
  }
  const notice=read('components/guardians/GuardianSavedNotice.tsx');
  assert.equal((notice.match(/<button/g)??[]).length,1); assert.match(notice,/Once you activate your ETERPAX plan/);
});

test('migration static review: privileged atomic operations, history retained, initial countdown gate', () => {
  const sql=read('supabase/migrations/202610060002_guardian_confirmation_model.sql');
  assert.match(sql,/begin;[\s\S]*commit;/);
  assert.match(sql,/unique \(user_id, guardian_id\)/); assert.match(sql,/unique \(user_id, email\)/);
  assert.match(sql,/on delete set null/); assert.match(sql,/on conflict do nothing/);
  assert.match(sql,/n.status = 'queued'/); assert.match(sql,/for update skip locked/);
  assert.match(sql,/set status = 'sending', attempted_at/);
  assert.match(sql,/queue_guardian_notifications\(p_user_id, added\)/);
  assert.match(sql,/where id = guardian_id and user_id = p_user_id/);
  assert.match(sql,/current_ids is distinct from expected_ids/);
  assert.match(sql,/if created = 1 then/);
  assert.match(sql,/next_check_in_at = p_activated_at \+ make_interval\(days => frequency_days\)/);
  assert.match(sql,/new.enabled := false/);
  assert.match(sql,/before insert on public.check_ins/);
  assert(!/before insert or update on public.check_ins/.test(sql));
  assert.match(sql,/awaiting_plan_activation boolean not null default false/);
  assert.match(sql,/legacy_suppressed/);
  assert.match(sql,/revoke all on function public.sync_guardian_plan_subscription\(jsonb,timestamptz\) from public,anon,authenticated/);
  assert(!/create table.*(?:invitation|escalation|vote|release)/i.test(sql));
});

// Mirrors the actual deployed check_ins_engine_state_check from schema_evidence.
function deployedCheckInConstraint(c) {
  return c.frequency_days > 0 && (
    (c.status === 'scheduled' && c.missed_count >= 0 && c.missed_count <= 2
      && c.next_check_in_at !== null && c.response_deadline_at === null)
    || (c.status === 'awaiting_response' && c.missed_count >= 0 && c.missed_count <= 2
      && c.next_check_in_at === null && c.response_deadline_at !== null)
    || (c.status === 'escalation_pending' && c.missed_count === 3
      && c.next_check_in_at === null && c.response_deadline_at === null)
  );
}

test('deployed scheduled constraint remains satisfied before and after first activation', async () => {
  const h=harness();
  assert.equal(h.state.checkIn.enabled,false);
  assert(deployedCheckInConstraint(h.state.checkIn));
  assert(!deployedCheckInConstraint({...h.state.checkIn,next_check_in_at:null}));
  const preserved={last:h.state.checkIn.last_check_in_at,updated:h.state.checkIn.updated_at};
  stripeState(h); await webhook(h);
  assert(deployedCheckInConstraint(h.state.checkIn));
  assert.equal(h.state.checkIn.enabled,true);
  assert.equal(h.state.checkIn.awaiting_plan_activation,false);
  assert.equal(h.state.checkIn.next_check_in_at,iso(1700000000+75*86400));
  assert.equal(h.state.checkIn.last_check_in_at,preserved.last);
  assert.equal(h.state.checkIn.updated_at,preserved.updated);
});

test('all historical states survive first payment and retries with every existing field intact', async () => {
  const states=[
    {status:'scheduled',missed_count:0,next_check_in_at:iso(1800000000),response_deadline_at:null},
    {status:'scheduled',missed_count:2,next_check_in_at:iso(1600000000),response_deadline_at:null},
    {status:'awaiting_response',missed_count:1,next_check_in_at:null,response_deadline_at:iso(1700000500)},
    {status:'escalation_pending',missed_count:3,next_check_in_at:null,response_deadline_at:null},
  ];
  for(const enabled of [true,false]) for(const fields of states) {
    const h=harness();
    h.state.checkIn={...h.state.checkIn,...fields,enabled,last_check_in_at:iso(1500000100),awaiting_plan_activation:false};
    h.state.nextCheckIn=h.state.checkIn.next_check_in_at;
    const before=structuredClone(h.state.checkIn);
    assert(deployedCheckInConstraint(before));
    stripeState(h); await webhook(h); await webhook(h);
    assert.deepEqual(h.state.checkIn,before);
    assert.equal(h.state.nextCheckIn,before.next_check_in_at);
    assert(deployedCheckInConstraint(h.state.checkIn));
  }
});

test('existing active legacy schedule is not reanchored on renewal', async () => {
  const h=harness(); h.state.activation='legacy';
  h.state.checkIn={...h.state.checkIn,enabled:true,awaiting_plan_activation:false,next_check_in_at:iso(1850000000)};
  const before=structuredClone(h.state.checkIn);
  stripeState(h); await webhook(h);
  assert.deepEqual(h.state.checkIn,before);
});

test('legacy Guardian identities with duplicate/null emails remain suppressed at later activation', async () => {
  const h=harness();
  h.state.guardians=[1,2,3].map((n)=>({...input(n),id:`legacy-${n}`,user_id:owner,email:n===3?null:'same@example.com'}));
  h.state.notifications=h.state.guardians.map(g=>({id:`suppressed-${g.id}`,user_id:owner,guardian_id:g.id,email:null,status:'legacy_suppressed'}));
  // A previously missing email repaired by its owner is still a legacy identity.
  h.state.guardians[2].email='repaired@example.com';
  stripeState(h); await webhook(h);
  assert.equal(h.state.sends.length,0);
  assert(h.state.notifications.every(n=>n.status==='legacy_suppressed'));
});

test('nullable deployed Guardian fields load safely without changing database records', async () => {
  const h=harness();
  h.state.guardians=[{id:'legacy',user_id:owner,name:null,email:null,relationship:null}];
  const before=structuredClone(h.state.guardians);
  const response=await h.api.GET(new Request('https://eterpax.example/api/guardians',{headers:{Authorization:'Bearer valid'}}));
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.guardians[0].name,''); assert.equal(body.guardians[0].email,''); assert.equal(body.guardians[0].relationship,'');
  assert.deepEqual(h.state.guardians,before);
});

test('SQL makes no top-level Check-in updates and never assigns historical state fields', () => {
  const sql=read('supabase/migrations/202610060002_guardian_confirmation_model.sql');
  const withoutBodies=sql.replace(/\$\$[\s\S]*?\$\$/g,'').replace(/--[^\n]*/g,'');
  assert(!/\b(update|delete\s+from|insert\s+into)\s+public\.check_ins/i.test(withoutBodies));
  assert(!/create\s+(or\s+replace\s+)?function\s+public\.(save_check_in_configuration|confirm_check_in|process_continuity_engine|enqueue_continuity_check_in_request)\b/i.test(sql));
  const gate=sql.slice(sql.indexOf('create function public.guard_check_in_activation'),sql.indexOf('-- Trusted, signature-verified webhook'));
  assert(!/new\.(status|missed_count|last_check_in_at|response_deadline_at)\s*:=/i.test(gate));
  assert(!/new\.next_check_in_at\s*:=\s*null/i.test(gate));
  assert.match(gate,/set timezone = 'UTC'/);
  const update=sql.match(/update public\.check_ins set[\s\S]*?;/i)[0];
  assert(!/\b(status|missed_count|last_check_in_at|response_deadline_at|updated_at)\s*=/.test(update.split(/\bwhere\b/i)[0]));
  assert.match(update,/awaiting_plan_activation = true/);
  assert.match(update,/and enabled = false and status = 'scheduled' and missed_count = 0/);
  const suppression=sql.match(/insert into public\.guardian_notifications\(user_id, guardian_id, email, status\)[\s\S]*?;/)[0];
  assert.match(suppression,/null::text, 'legacy_suppressed'/);
  assert(!/join public\.guardian_plan_activations/.test(suppression));
});

async function legacyActive() {
  const h = harness();
  await save(h, [input(1), input(2), input(3)]);
  h.state.active = true;
  h.state.activation = { legacy: true, activated_at: null };
  h.state.notifications = h.state.guardians.map((g, i) => ({
    id: `legacy-notification-${i}`, user_id: owner, guardian_id: g.id,
    email: null, status: 'legacy_suppressed',
  }));
  return h;
}

test('legacy active with NULL activation timestamp: new Guardian gets exactly one notification', async () => {
  const h = await legacyActive();
  assert.equal((await save(h, [...existing(h), input(4)])).status, 200);
  assert.deepEqual(h.state.sends.map(s => s.email.to), ['g4@example.com']);
  assert.equal(h.state.notifications.filter(n => n.status !== 'legacy_suppressed').length, 1);
  assert.equal(h.state.notifications.filter(n => n.status === 'legacy_suppressed').length, 3);
});

test('legacy active name/relationship edit produces zero notifications', async () => {
  const h = await legacyActive(); const rows = existing(h);
  rows[0].name = 'Changed'; rows[0].relationship = 'Sibling';
  await save(h, rows);
  assert.equal(h.state.sends.length, 0);
  assert.equal(h.state.notifications.length, 3);
});

test('legacy active email change notifies only the new email exactly once', async () => {
  const h = await legacyActive(); const rows = existing(h);
  rows[0].email = 'new@example.com';
  await save(h, rows); await save(h, existing(h));
  assert.deepEqual(h.state.sends.map(s => s.email.to), ['new@example.com']);
  assert.equal(h.state.notifications.filter(n => n.status !== 'legacy_suppressed').length, 1);
  assert.equal(h.state.notifications.filter(n => n.status === 'legacy_suppressed').length, 3);
});

test('legacy active removal/replacement notifies only the new Guardian', async () => {
  const h = await legacyActive();
  await save(h, [...existing(h).slice(1), input(4)]);
  assert.deepEqual(h.state.sends.map(s => s.email.to), ['g4@example.com']);
});

test('legacy active unchanged save creates no duplicates', async () => {
  const h = await legacyActive();
  await save(h, existing(h)); await save(h, existing(h));
  assert.equal(h.state.notifications.length, 3); assert.equal(h.state.sends.length, 0);
});

test('already notified Guardian email change retains old attempt and deduplicates the new address', async () => {
  const h = harness(); await save(h, [input(1), input(2)]); stripeState(h); await webhook(h);
  const rows = existing(h); rows[0].email = 'changed@example.com';
  await save(h, rows); await save(h, existing(h));
  assert.deepEqual(h.state.sends.map(s => s.email.to), ['g1@example.com', 'g2@example.com', 'changed@example.com']);
  const back = existing(h); back[0].email = 'g1@example.com'; await save(h, back);
  assert.equal(h.state.sends.length, 3);
});

test('follow-up SQL changes selection only and preserves per-address history and service grants', () => {
  const sql = read('supabase/migrations/202610060003_guardian_notification_selection.sql');
  assert.match(sql, /drop constraint guardian_notifications_user_id_guardian_id_key/);
  assert(!/drop constraint guardian_notifications_user_id_email_key/.test(sql));
  assert.match(sql, /previous_email is distinct from email_value/);
  assert.match(sql, /queue_guardian_notifications\(p_user_id, notification_ids\)/);
  assert.match(sql, /p_guardian_ids is not null or not exists/);
  assert.match(sql, /n.status = 'legacy_suppressed'/);
  assert.match(sql, /s.status = 'active'/);
  assert(!/activated_at|check_ins|claim_guardian_notifications|sync_guardian_plan_subscription/.test(sql));
  assert(!/delete from public.guardian_notifications|update public.guardian_notifications|grant |revoke /i.test(sql));
  assert.equal((sql.match(/create or replace function/g) ?? []).length, 2);
});

async function diagnosticAttempt(result, exception) {
  const h = harness(); await save(h, [input(1), input(2)]); stripeState(h);
  h.state.providerResult = result; h.state.providerException = exception;
  await webhook(h);
  return h;
}

test('provider errors log only allowed diagnostics and retain uncertain/no-retry behavior', async () => {
  const h = await diagnosticAttempt({ data: null, error: { name: 'invalid_api_key', statusCode: 401, message: 'API key is invalid' } });
  assert.equal(h.state.logs.length, 2);
  for (const [, log] of h.state.logs) {
    assert.equal(log.category, 'provider_error'); assert.equal(log.name, 'invalid_api_key');
    assert.equal(log.status, 401); assert.equal(log.message, 'API key is invalid');
    assert(h.state.notifications.some(n => n.id === log.notificationId));
  }
  assert(h.state.notifications.every(n => n.status === 'uncertain' && n.provider_message_id === null && !n.sent_at));
  await save(h, existing(h)); assert.equal(h.state.sends.length, 2); assert.equal(h.state.logs.length, 2);
});

test('missing provider ID has a distinct diagnostic', async () => {
  const h = await diagnosticAttempt({ data: {}, error: null });
  assert.equal(h.state.logs.length, 2);
  assert(h.state.logs.every(([, log]) => log.category === 'missing_provider_id'));
  assert(h.state.notifications.every(n => n.status === 'uncertain' && n.provider_message_id === null && !n.sent_at));
});

test('send exception has a distinct diagnostic and safe exception details', async () => {
  const h = await diagnosticAttempt(undefined, new TypeError('fetch failed'));
  assert.equal(h.state.logs.length, 2);
  assert(h.state.logs.every(([, log]) => log.category === 'send_exception' && log.name === 'TypeError' && log.message === 'fetch failed'));
  assert(h.state.notifications.every(n => n.status === 'uncertain' && n.provider_message_id === null && !n.sent_at));
});

test('arbitrary provider/exception strings, response content and secrets never reach logs', async () => {
  const secret = 'g1@example.com Guardian 1 <b>Alex</b> mock-email-key Bearer private-token PRIVATE BODY';
  for (const thrown of [false, true]) {
    const detail = { name: secret, message: secret, statusCode: secret, code: secret, stack: secret, cause: secret };
    const h = await diagnosticAttempt(thrown ? undefined : { error: detail, data: { content: secret } }, thrown ? detail : undefined);
    assert.equal(h.state.logs.length, 2);
    for (const [, log] of h.state.logs) {
      assert.deepEqual(Object.keys(log).sort(), ['category', 'name', 'notificationId']);
      assert.equal(log.name, 'unrecognized_or_absent');
    }
    assert(!JSON.stringify(h.state.logs).includes(secret));
  }
});

test('successful send remains sent with provider ID and timestamp, without failure logs', async () => {
  const h = await diagnosticAttempt({ data: { id: 'confirmed-provider-id' }, error: null });
  assert.equal(h.state.logs.length, 0);
  assert(h.state.notifications.every(n => n.status === 'sent' && n.provider_message_id === 'confirmed-provider-id' && n.sent_at));
  await save(h, existing(h)); assert.equal(h.state.sends.length, 2);
});
