import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('recovery cron coexists with the unchanged Continuity schedule', () => {
  const { crons } = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.deepEqual(crons.filter(job => job.path === '/api/cron/continuity'), [
    { path: '/api/cron/continuity', schedule: '0 * * * *' },
  ]);
  assert.deepEqual(crons.filter(job => job.path === '/api/cron/message-recovery'), [
    { path: '/api/cron/message-recovery', schedule: '* * * * *' },
  ]);
});
