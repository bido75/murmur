import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskInput } from './agent_actions.ts';
import type { Utterance } from './verify.ts';

const utts: Utterance[] = [{ start_ms: 2500, end_ms: 7000, speaker: 0, text: 'I will ship the prototype by Friday.' }];

test('buildTaskInput returns a grounded task when the quote matches', () => {
  const out = buildTaskInput({ recording_id: 'r1', text: 'Ship prototype', owner: 'Sam', quote: 'ship the prototype by Friday' }, utts);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.task.owner, 'Sam');
    assert.equal(out.task.owner_basis, 'named');
    assert.equal(out.task.quote_ms, 2500);
    assert.equal(out.task.verified, true);
    assert.equal(out.task.needs_review, false);
  }
});

test('buildTaskInput rejects a quote not in the transcript', () => {
  const out = buildTaskInput({ recording_id: 'r1', text: 'X', quote: 'totally invented words' }, utts);
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(out.reason, /not found/);
});

test('buildTaskInput rejects missing text or quote', () => {
  assert.equal(buildTaskInput({ recording_id: 'r1', text: '', quote: 'x' }, utts).ok, false);
  assert.equal(buildTaskInput({ recording_id: 'r1', text: 'x', quote: '' }, utts).ok, false);
});

test('empty owner becomes unassigned', () => {
  const out = buildTaskInput({ recording_id: 'r1', text: 'T', quote: 'ship the prototype by Friday' }, utts);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.task.owner, null);
    assert.equal(out.task.owner_basis, 'unassigned');
  }
});
