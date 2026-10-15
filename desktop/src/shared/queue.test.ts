import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, markFailed, runnable, storagePath, type Op } from './queue.ts';

const base = { attempts: 0, nextAt: 0 };
const q: Op[] = [
  { ...base, kind: 'create', recordingId: 'r1', title: 't', template: 'meeting', projectId: null, consentMethod: 'told_everyone', consentAt: null, createdAt: '' },
  { ...base, kind: 'segment', recordingId: 'r1', idx: 1, path: '/p/1', ext: 'webm', durationMs: 1 },
  { ...base, kind: 'segment', recordingId: 'r2', idx: 1, path: '/p/2', ext: 'webm', durationMs: 1, nextAt: 10_000 },
  { ...base, kind: 'finalize', recordingId: 'r2', durationMs: 1 },
];

test('only the first op per recording runs, and only after its backoff', () => {
  assert.deepEqual(runnable(q, 5000).map((o) => `${o.recordingId}:${o.kind}`), ['r1:create']);
  assert.deepEqual(runnable(q, 20_000).map((o) => `${o.recordingId}:${o.kind}`), ['r1:create', 'r2:segment']);
});

test('backoff doubles and caps at 10 minutes', () => {
  assert.equal(backoffMs(1), 10_000);
  assert.equal(backoffMs(20), 600_000);
  const f = markFailed(q[0], 'offline', 1000);
  assert.deepEqual([f.attempts, f.nextAt, f.lastError], [1, 11_000, 'offline']);
});

test('storage path matches the phone app layout', () => {
  assert.equal(storagePath('u', q[1] as Extract<Op, { kind: 'segment' }>), 'u/r1/seg-0001.webm');
});
