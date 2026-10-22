import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/activation-policy/presentation.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(output, { exports, Intl, Date });
const { parseActivationEligibility, protectionPresentation } = exports;
const record = {
  status: 'preparation', evaluated_at: '2026-10-21T12:00:00Z',
  starts_at: '2026-10-21T12:00:00Z', preparation_ends_at: '2026-11-05T12:00:00Z',
  recovery_ends_at: '2026-11-20T12:00:00Z',
};
test('server phase is preserved without consulting the client date; deadline explicitly UTC', () => {
  const view = protectionPresentation(parseActivationEligibility(record));
  assert.equal(view.title, 'Preparation');
  assert.match(view.deadline, /Nov 5, 2026, 12:00 PM UTC/);
  assert.match(protectionPresentation({ ...record, status: 'recovery' }).deadline, /Nov 20, 2026/);
});
test('review does not promise deletion or enforced restrictions', () => {
  const view = protectionPresentation({ ...record, status: 'review_pending' });
  assert.match(view.detail, /No deletion is scheduled/);
});
test('active and former subscribers have no preparation deadlines', () => {
  for (const status of ['active', 'exempt_previous_subscriber']) {
    const row = parseActivationEligibility({ ...record, status, starts_at: null, preparation_ends_at: null, recovery_ends_at: null });
    assert.equal(protectionPresentation(row).deadline, 'No preparation deadline applies.');
  }
});
test('missing or malformed RPC results never masquerade as expiry', () => {
  for (const row of [null, {}, { ...record, status: 'invalid' }, { ...record, preparation_ends_at: null }, { ...record, evaluated_at: 'invalid' }]) {
    assert.throws(() => parseActivationEligibility(row));
  }
});
