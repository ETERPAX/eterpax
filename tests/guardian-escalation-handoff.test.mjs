import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
// SQL shape only: not a SQL parser, execution test, or concurrency proof.
const normalize = text => text.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g,
  token => token.startsWith("'") ? token : ' ').replace(/\s+/g, ' ').trim();
const sql = normalize(read('202610080002_guardian_escalation_handoff.sql'));
const foundation = normalize(read('202610070001_guardian_escalation_safety_foundation.sql'));
const owner = normalize(read('202610080001_guardian_escalation_owner_check_in.sql'));
const selection = normalize(read('202610060003_guardian_notification_selection.sql'));
const body = sql.split('$function$')[1];
const handoff = body.slice(body.indexOf("elsif v_row.status = 'awaiting_response' and v_row.missed_count = 2"));

test('snapshot has only five fields, historical source identity and cascading parent', () => {
  const table = sql.match(/create table public\.guardian_escalation_participants \((.*?)\);/)[1];
  assert.match(table, /^ escalation_id uuid not null, source_guardian_id uuid not null, name text not null, relationship text not null, email text not null,/);
  assert.match(table, /primary key \(escalation_id, source_guardian_id\)/);
  assert.match(table, /unique \(escalation_id, email\)/);
  assert.match(table, /foreign key \(escalation_id\) references public\.guardian_escalations\(id\) on delete cascade/);
  assert.equal((table.match(/references /g) ?? []).length, 1);
  for (const field of ['name', 'relationship']) {
    assert(table.includes(`check (${field} = btrim(${field}) and length(${field}) between 1 and 254)`));
  }
  assert.match(table, /email = lower\(btrim\(email\)\) and length\(email\) between 1 and 254/);
});

test('snapshot RLS and read-only service access; engine remains server-only', () => {
  assert(sql.includes('alter table public.guardian_escalation_participants enable row level security;'));
  assert(sql.includes('revoke all on public.guardian_escalation_participants from public, anon, authenticated, service_role;'));
  assert(sql.includes('grant select on public.guardian_escalation_participants to service_role;'));
  assert(sql.includes('alter function public.process_continuity_engine() owner to postgres;'));
  assert(sql.includes('revoke all on function public.process_continuity_engine() from public, anon, authenticated;'));
  assert(sql.includes('grant execute on function public.process_continuity_engine() to service_role;'));
  assert.equal((sql.match(/\bgrant /g) ?? []).length, 2);
});

test('status CHECK changes only add blocked to terminal-compatible branches', () => {
  for (const name of ['status', 'closed_at', 'owner_check_in']) {
    const constraint = `guardian_escalations_${name}_check`;
    const oldStart = foundation.indexOf(`constraint ${constraint} check`);
    const oldEnd = foundation.indexOf(', constraint ', oldStart + 1);
    const oldText = foundation.slice(oldStart, oldEnd);
    const newStart = sql.indexOf(`add constraint ${constraint} check`);
    const newEnd = sql.indexOf(name === 'owner_check_in' ? ';' : ', add constraint ', newStart + 1);
    const newText = sql.slice(newStart + 4, newEnd).replaceAll(", 'blocked_invalid_guardian_set'", '');
    // Formatting parentheses are insignificant; expressions must otherwise match.
    assert.equal(newText.replaceAll(' ', ''), oldText.replaceAll(' ', ''));
  }
  assert.doesNotMatch(sql, /drop (?:index|table)|check_ins_engine_|one_active_per_check_in/);
});

test('engine signature, guards, one clock, eligibility and batch locking preserved', () => {
  assert(sql.includes('returns table(check_in_id uuid, old_status text, new_status text, old_missed_count integer, new_missed_count integer)'));
  assert(sql.includes("language plpgsql security definer set search_path to '' set \"TimeZone\" to 'UTC'"));
  assert(body.includes("if v_environment is distinct from 'production' then"));
  for (const variable of ['v_response_window', 'v_after_miss_1', 'v_after_miss_2']) {
    assert(body.includes(`${variable} is null`));
    assert(body.includes(`${variable} <= interval '0 seconds'`));
  }
  assert.equal((body.match(/clock_timestamp\(\)/g) ?? []).length, 1);
  assert(body.includes('where c.enabled = true and ('));
  assert(body.includes('order by coalesce(c.next_check_in_at, c.response_deadline_at), c.id for update skip locked limit 100'));
  assert.doesNotMatch(sql, /pg_advisory/);
});

test('three earlier transition assignments remain exactly the supplied engine behavior', () => {
  const updates = [...body.matchAll(/update public\.check_ins as c set (.*?) where c.id = v_row.id;/g)].map(m => m[1]);
  assert.deepEqual(updates, [
    "status = 'awaiting_response', next_check_in_at = null, response_deadline_at = v_now + v_response_window, updated_at = v_now",
    "status = 'scheduled', missed_count = 1, next_check_in_at = v_row.response_deadline_at + v_after_miss_1, response_deadline_at = null, updated_at = v_now",
    "status = 'scheduled', missed_count = 2, next_check_in_at = v_row.response_deadline_at + v_after_miss_2, response_deadline_at = null, updated_at = v_now",
    "status = 'escalation_pending', missed_count = 3, next_check_in_at = null, response_deadline_at = null, updated_at = v_now",
  ]);
  assert(body.includes("elsif v_row.status = 'awaiting_response' and v_row.missed_count = 0 then"));
  assert(body.includes("elsif v_row.status = 'awaiting_response' and v_row.missed_count = 1 then"));
});

test('complete Guardian set captured once and validated without filtering invalid rows', () => {
  assert.equal((sql.match(/from public\.guardians\b/g) ?? []).length, 1);
  assert(handoff.includes('into v_guardians from public.guardians as g where g.user_id = v_row.user_id;'));
  assert.equal((handoff.match(/jsonb_to_recordset\(v_guardians\)/g) ?? []).length, 2);
  assert(handoff.includes('count(*) between 2 and 6 and count(p.id) = count(*) and count(distinct p.id) = count(*)'));
  for (const field of ['name', 'relationship', 'email']) {
    assert(handoff.includes(`p.${field} is not null and length(btrim(p.${field})) > 0 and length(p.${field}) <= 254`));
  }
  const pattern = selection.match(/email_value !~ ('[^']*')/)[1];
  assert(handoff.includes(`lower(btrim(p.email)) ~ ${pattern}`));
  assert(handoff.includes('count(distinct lower(btrim(p.email))) = count(*)'));
});

test('valid and blocked outcomes share unchanged generation and one timestamp', () => {
  assert(handoff.includes('v_row.response_deadline_at <= v_now then'));
  assert(handoff.includes("values (v_row.id, v_row.user_id, v_row.escalation_generation, case when v_valid then 'waiting_for_responses' else 'blocked_invalid_guardian_set' end, v_now, case when v_valid then null else v_now end, null)"));
  assert.match(handoff, /if v_valid then insert into public\.guardian_escalation_participants .*?select v_escalation_id, p.id, btrim\(p.name\), btrim\(p.relationship\), lower\(btrim\(p.email\)\) from pg_catalog.jsonb_to_recordset\(v_guardians\).*?; end if;/);
  assert.doesNotMatch(body, /set escalation_generation|escalation_generation\s*\+|\bmax\(/);
});

test('preexisting identities fail rather than rebuild; no swallowed database errors', () => {
  assert(handoff.includes('where e.check_in_id = v_row.id and e.generation = v_row.escalation_generation for update; if found then raise exception'));
  assert.doesNotMatch(sql, /on conflict|update public\.guardian_escalations|update public\.guardian_escalation_participants|delete from/i);
  assert.doesNotMatch(body.replaceAll('raise exception', ''), /\bexception\b/);
  assert(handoff.indexOf('if found then raise exception') < handoff.indexOf('update public.check_ins'));
});

test('Change 2 preserves blocked history and still advances/rearms normally', () => {
  assert(owner.includes("and e.status in ('waiting_for_responses', 'safety_window');"));
  assert(owner.includes("and e.status in ('stopped_negative', 'frozen_no_majority')"));
  assert(owner.includes('escalation_generation = v_row.escalation_generation + 1'));
  assert.doesNotMatch(sql, /create or replace function public\.confirm_check_in/);
});

test('only authorized objects are introduced or referenced', () => {
  assert.deepEqual([...new Set([...sql.matchAll(/public\.(\w+)/g)].map(m => m[1]))].sort(), [
    'check_ins', 'continuity_timing_policy', 'eterpax_environment', 'guardian_escalation_participants',
    'guardian_escalations', 'guardians', 'process_continuity_engine',
  ]);
  assert.equal((sql.match(/create table /g) ?? []).length, 1);
  assert.equal((sql.match(/create or replace function /g) ?? []).length, 1);
  assert.doesNotMatch(sql, /create (?:policy|trigger)|\bexecute\b(?! on)|\bcall\b|\b(?:token|outbox|quorum|release|delivery)\b/i);
  assert(sql.startsWith('begin;'));
  assert(sql.endsWith('commit;'));
});
