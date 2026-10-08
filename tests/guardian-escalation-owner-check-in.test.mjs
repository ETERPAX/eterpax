import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL(
  '../supabase/migrations/202610080001_guardian_escalation_owner_check_in.sql',
  import.meta.url,
), 'utf8');
// Declaration/SQL-shape checks only; not a SQL parser or a database test.
const sql = source.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g,
  token => token.startsWith("'") ? token : ' ').replace(/\s+/g, ' ').trim();
const parts = sql.split('$function$');
assert.equal(parts.length, 3, 'Exactly one reviewed function body');
const [header, body, footer] = parts;
const updates = [...body.matchAll(/update public\.\w+ as \w+ set .*?;/g)].map(m => m[0]);
const [cancel, acknowledge, reset] = updates;

test('parameterless composite RPC preserves security settings and ownership boundary', () => {
  assert.match(header, /^begin; create or replace function public\.confirm_check_in\(\) returns public\.check_ins language plpgsql security definer set search_path to '' set "TimeZone" to 'UTC' as $/);
  assert.equal(footer.trim(), '; alter function public.confirm_check_in() owner to postgres; revoke all on function public.confirm_check_in() from public, anon; grant execute on function public.confirm_check_in() to authenticated; commit;');
});

test('authentication, parent ownership lock and existing validations precede child locks', () => {
  assert.match(body, /v_user_id := auth\.uid\(\); if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;/);
  assert.match(body, /select c\.\* into v_row from public\.check_ins as c where c\.user_id = v_user_id for update;/);
  assert.match(body, /if not found then raise exception 'Check-in configuration not found' using errcode = 'P0002'; end if;/);
  assert.match(body, /if v_row\.frequency_days is null or v_row\.frequency_days <= 0 then raise exception 'Invalid check-in frequency' using errcode = '22023'; end if;/);
  assert(body.indexOf('auth.uid()') < body.indexOf('select c.*'));
  assert(body.indexOf("errcode = '22023'") < body.indexOf('perform e.id'));
});

test('relevant child rows are locked in ID order before one clock capture', () => {
  assert.match(body, /perform e\.id from public\.guardian_escalations as e where e\.check_in_id = v_row\.id and e\.user_id = v_user_id and \( e\.status in \('waiting_for_responses', 'safety_window'\) or \( e\.status in \('stopped_negative', 'frozen_no_majority'\) and e\.generation = v_row\.escalation_generation and e\.owner_checked_in_at is null \) \) order by e\.id for update; v_now := pg_catalog\.clock_timestamp\(\);/);
  assert.equal((body.match(/clock_timestamp\(/g) ?? []).length, 1);
  assert.equal((body.match(/v_now :=/g) ?? []).length, 1);
  assert(body.indexOf('clock_timestamp()') < body.indexOf('update public.'));
  assert.doesNotMatch(sql, /advisory|skip locked|\bnow\s*\(/i);
});

test('all active generations are cancelled using the shared timestamp', () => {
  assert.equal(updates.length, 3);
  assert.equal(cancel, "update public.guardian_escalations as e set status = 'cancelled_owner_check_in', closed_at = v_now, owner_checked_in_at = v_now where e.check_in_id = v_row.id and e.user_id = v_user_id and e.status in ('waiting_for_responses', 'safety_window');");
  assert.doesNotMatch(cancel, /generation/);
});

test('terminal acknowledgement preserves outcome, closure and existing acknowledgement', () => {
  assert.equal(acknowledge, "update public.guardian_escalations as e set owner_checked_in_at = v_now where e.check_in_id = v_row.id and e.user_id = v_user_id and e.generation = v_row.escalation_generation and e.status in ('stopped_negative', 'frozen_no_majority') and e.owner_checked_in_at is null;");
});

test('schedule reset is unchanged and locked generation advances exactly once', () => {
  assert.equal(reset, "update public.check_ins as c set missed_count = 0, status = 'scheduled', last_check_in_at = v_now, next_check_in_at = v_now + v_row.frequency_days * interval '1 day', response_deadline_at = null, updated_at = v_now, escalation_generation = v_row.escalation_generation + 1 where c.id = v_row.id and c.user_id = v_user_id returning c.* into v_row;");
  assert.equal((body.match(/escalation_generation =/g) ?? []).length, 1);
  assert.match(body, /returning c\.\* into v_row; return v_row; end; $/);
  assert.doesNotMatch(body, /\bmax\s*\(/i);
});

test('no exception swallowing or internal transaction boundary', () => {
  assert.doesNotMatch(body.replace(/raise exception/g, ''), /\bexception\b|\bcommit\b|\brollback\b/i);
  assert.doesNotMatch(body, /\bexecute\b|\bcall\b/i);
});

test('no new workflow objects, table privileges, or unrelated application objects', () => {
  assert.doesNotMatch(sql, /\bcreate\s+(?:table|trigger|policy|index|procedure)\b|\balter table\b|\bdrop\b|\binsert\b|\bdelete\b|\bmerge\b/i);
  assert.equal((sql.match(/create or replace function/g) ?? []).length, 1);
  assert.deepEqual([...new Set([...sql.matchAll(/public\.(\w+)/g)].map(m => m[1]))].sort(),
    ['check_ins', 'confirm_check_in', 'guardian_escalations']);
  assert.doesNotMatch(sql, /\b(?:quorum|outbox|token|release|delivery|request)\b/i);
});
