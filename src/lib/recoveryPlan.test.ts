import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recoveryPlan,
  type InterruptedSession,
  type InterruptedPart,
} from './recoveryPlan.ts';

const session: InterruptedSession = {
  recordingId: 'r-1',
  segIdx: 3,
  doneMs: 12_000,
  currentUri: 'file:///cache/rec-r-1-3.m4a',
};

const present: InterruptedPart = {
  present: true,
  readable: true,
  keptUri: 'file:///docs/pending-audio/rec-r-1-3.m4a',
};

test('a session with a readable part recovers the part and finalizes', () => {
  const plan = recoveryPlan(session, present);
  assert.equal(plan.recordingId, 'r-1');
  assert.deepEqual(plan.ops, [
    {
      kind: 'segment',
      recordingId: 'r-1',
      idx: 3,
      localUri: 'file:///docs/pending-audio/rec-r-1-3.m4a',
      ext: 'm4a',
      durationMs: 0,
    },
    { kind: 'finalize', recordingId: 'r-1', durationMs: 12_000 },
  ]);
});

test('a local (on-device) session recovers a WAV part without an ext', () => {
  const local: InterruptedSession = { ...session, local: true };
  const plan = recoveryPlan(local, present);
  assert.deepEqual(plan.ops[0], {
    kind: 'local_segment',
    recordingId: 'r-1',
    idx: 3,
    localUri: present.keptUri!,
    offsetMs: 12_000,
    durationMs: 0,
  });
  assert.deepEqual(plan.ops[1], {
    kind: 'local_finalize',
    recordingId: 'r-1',
    durationMs: 12_000,
  });
});

test('an unreadable part is skipped but the recording still finalizes', () => {
  // This is the case that must never lose the recording: the OS truncated the
  // partial file, yet earlier parts were already queued.
  for (const part of [
    { present: false, readable: false, keptUri: null },
    { present: true, readable: false, keptUri: null },
  ] as InterruptedPart[]) {
    const plan = recoveryPlan(session, part);
    assert.deepEqual(plan.ops, [{ kind: 'finalize', recordingId: 'r-1', durationMs: 12_000 }]);
    assert.equal(plan.recordingId, 'r-1');
  }
});

test('no interrupted session recovers nothing', () => {
  const plan = recoveryPlan(null, present);
  assert.deepEqual(plan.ops, []);
  assert.equal(plan.recordingId, null);
});

test('a finalize is always queued for a real session, so nothing hangs in recording forever', () => {
  const cases: [InterruptedSession, InterruptedPart][] = [
    [session, present],
    [session, { present: true, readable: false, keptUri: null }],
    [session, { present: false, readable: false, keptUri: null }],
  ];
  for (const [s, p] of cases) {
    const ops = recoveryPlan(s, p).ops;
    const finalize = ops[ops.length - 1];
    assert.ok(
      finalize && (finalize.kind === 'finalize' || finalize.kind === 'local_finalize'),
      `expected a finalize for ${JSON.stringify(p)}`,
    );
  }
  // No session at all correctly produces no operations.
  assert.deepEqual(recoveryPlan(null, present).ops, []);
});