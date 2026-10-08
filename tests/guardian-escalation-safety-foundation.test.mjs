import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL(
  '../supabase/migrations/202610070001_guardian_escalation_safety_foundation.sql',
  import.meta.url,
), 'utf8');

// Static inspection only: no SQL execution, PostgreSQL semantics, locking, or
// effective-role permission claims. Preserve string literals while removing
// comments so comments cannot satisfy assertions or trigger forbidden keywords.
const sql = source.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g,
  token => token.startsWith("'") ? token : ' ').replace(/\s+/g, ' ').trim();
const statements = sql.split(';').map(statement => statement.trim()).filter(Boolean);
const statuses = [
  'waiting_for_responses', 'safety_window', 'stopped_negative',
  'frozen_no_majority', 'cancelled_owner_check_in',
];

function statementMatching(pattern) {
  const matches = statements.filter(statement => pattern.test(statement));
  assert.equal(matches.length, 1, `Expected one statement matching ${pattern}`);
  return matches[0];
}

function literalList(text) {
  const values = [...text.matchAll(/'((?:''|[^'])*)'/g)].map(match => match[1]);
  assert.match(text.replace(/'(?:''|[^'])*'/g, ''), /^[\s,]*$/);
  return values.sort();
}

function tableBody() {
  const statement = statementMatching(/^create table public\.guardian_escalations\s*\(/i);
  return statement.slice(statement.indexOf('(') + 1, statement.lastIndexOf(')'));
}

// Split table declarations at top-level commas, not commas inside constraints.
function declarations(body) {
  const result = [];
  let depth = 0;
  let start = 0;
  for (const match of body.matchAll(/'(?:''|[^'])*'|[(),]/g)) {
    if (match[0] === '(') depth++;
    if (match[0] === ')') depth--;
    if (match[0] === ',' && depth === 0) {
      result.push(body.slice(start, match.index).trim());
      start = match.index + 1;
    }
  }
  result.push(body.slice(start).trim());
  return result;
}

test('Check-in generation is non-null, defaults to zero, and has supporting constraints', () => {
  const statement = statementMatching(/^alter table public\.check_ins\b/i);
  assert.match(statement, /add column escalation_generation bigint not null default 0\b/i);
  assert.match(statement, /check\s*\(\s*escalation_generation\s*>=\s*0\s*\)/i);
  assert.match(statement, /unique\s*\(\s*id\s*,\s*user_id\s*\)/i);
});

test('escalation table contains exactly the foundation columns', () => {
  const columns = declarations(tableBody()).filter(part => !/^constraint\b/i.test(part));
  assert.deepEqual(columns.map(part => part.split(' ')[0].toLowerCase()).sort(), [
    'id', 'check_in_id', 'user_id', 'generation', 'status', 'created_at',
    'closed_at', 'owner_checked_in_at',
  ].sort());
  for (const name of ['check_in_id', 'user_id']) {
    assert(columns.some(column => new RegExp(`^${name} uuid not null$`, 'i').test(column)));
  }
  assert(columns.some(column => /^id uuid primary key default gen_random_uuid\s*\(\s*\)$/i.test(column)));
  assert(columns.some(column => /^generation bigint not null$/i.test(column)));
  assert(columns.some(column => /^status text not null$/i.test(column)));
  assert(columns.some(column => /^created_at timestamptz not null default now\s*\(\s*\)$/i.test(column)));
  for (const name of ['closed_at', 'owner_checked_in_at']) {
    assert(columns.some(column => new RegExp(`^${name} timestamptz$`, 'i').test(column)));
  }
});

test('status constraint admits exactly the five approved status literals', () => {
  const constraint = declarations(tableBody()).find(part =>
    /^constraint guardian_escalations_status_check\b/i.test(part));
  assert(constraint, 'Missing status constraint');
  const match = constraint.match(/^constraint guardian_escalations_status_check check\s*\(\s*status in\s*\(([^()]*)\)\s*\)$/i);
  assert(match, 'Expected the approved status IN check without an alternative branch');
  assert.deepEqual(literalList(match[1]), [...statuses].sort());
});

test('parent ownership uses the composite reference with both cascade actions', () => {
  assert.match(tableBody(), /foreign key\s*\(\s*check_in_id\s*,\s*user_id\s*\)\s*references public\.check_ins\s*\(\s*id\s*,\s*user_id\s*\)\s*on update cascade on delete cascade\b/i);
});

test('generation identity is nonnegative and unique across all escalation statuses', () => {
  assert.match(tableBody(), /check\s*\(\s*generation\s*>=\s*0\s*\)/i);
  assert.match(tableBody(), /unique\s*\(\s*check_in_id\s*,\s*generation\s*\)/i);
});

test('active uniqueness covers exactly waiting and safety statuses on the parent', () => {
  const statement = statementMatching(/^create unique index\b/i);
  const match = statement.match(/^create unique index \w+ on public\.guardian_escalations\s*\(\s*check_in_id\s*\)\s*where status in\s*\(([^()]*)\)$/i);
  assert(match, 'Expected a unique parent index with only the approved predicate');
  assert.deepEqual(literalList(match[1]), ['safety_window', 'waiting_for_responses']);
});

test('RLS and explicit privileges match protected server-managed tables', () => {
  statementMatching(/^alter table public\.guardian_escalations enable row level security$/i);
  const revoke = statementMatching(/^revoke\b/i);
  const match = revoke.match(/^revoke all(?: privileges)? on (?:table )?public\.guardian_escalations from (.+)$/i);
  assert(match);
  assert.deepEqual(match[1].toLowerCase().split(',').map(role => role.trim()).sort(),
    ['anon', 'authenticated', 'public']);
  statementMatching(/^grant all(?: privileges)? on (?:table )?public\.guardian_escalations to service_role$/i);
  assert.equal(statements.filter(statement => /^grant\b/i.test(statement)).length, 1);
});

test('migration stays within inert foundation DDL and introduces no processing', () => {
  assert.doesNotMatch(sql, /\bcreate\s+(?:or replace\s+)?(?:function|procedure|trigger|policy)\b/i);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update\s+public\.|delete\s+from|merge\s+into)\b/i);
  // A statement allowlist also rejects DO/CALL blocks, extra tables (responses,
  // tokens, outboxes), and other executable additions rather than guessing
  // workflow behavior from names such as 'quorum' or 'delivery' in comments.
  const allowed = [
    /^begin$/i, /^commit$/i,
    /^alter table public\.check_ins\s+add column\b/i,
    /^create table public\.guardian_escalations\s*\(/i,
    /^create unique index \w+ on public\.guardian_escalations\s*\(/i,
    /^alter table public\.guardian_escalations enable row level security$/i,
    /^revoke all(?: privileges)? on (?:table )?public\.guardian_escalations from\b/i,
    /^grant all(?: privileges)? on (?:table )?public\.guardian_escalations to service_role$/i,
  ];
  assert.equal(statements.length, allowed.length, 'Unexpected additional or missing DDL');
  for (const statement of statements) {
    assert(allowed.some(pattern => pattern.test(statement)), `Out-of-scope statement: ${statement}`);
  }
  assert.equal(statements[0].toLowerCase(), 'begin');
  assert.equal(statements.at(-1).toLowerCase(), 'commit');
});

test('existing Check-in engine constraints are untouched', () => {
  assert.doesNotMatch(sql, /\bcheck_ins_engine_(?:state|status)_check\b/i);
  assert.doesNotMatch(sql, /\bdrop\b|\balter\s+constraint\b/i);
});
