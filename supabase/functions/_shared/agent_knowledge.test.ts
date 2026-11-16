import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntity, groundAssertion, withVerificationStatus, normalizeName } from './agent_knowledge.ts';
import type { Utterance } from './verify.ts';

test('resolveEntity matches by canonical name', () => {
  const index = [{ id: 'e1', name: 'Maya Chen', aliases: [] }];
  assert.deepEqual(resolveEntity(' maya chen ', index), { id: 'e1', matchedBy: 'name' });
});

test('resolveEntity matches by alias, case-insensitively', () => {
  const index = [{ id: 'e1', name: 'Maya Chen', aliases: ['M', 'MC'] }];
  assert.deepEqual(resolveEntity('mc', index), { id: 'e1', matchedBy: 'alias' });
});

test('resolveEntity returns null when unknown', () => {
  assert.deepEqual(resolveEntity('Nobody', [{ id: 'e1', name: 'Maya', aliases: [] }]), { id: null, matchedBy: null });
});

test('normalizeName trims and lowercases', () => {
  assert.equal(normalizeName('  Maya Chen '), 'maya chen');
});

const utts: Utterance[] = [
  { start_ms: 1000, end_ms: 5000, speaker: 0, text: 'Maya works on the Riverside project.' },
  { start_ms: 6000, end_ms: 9000, speaker: 1, text: 'The deadline is Friday.' },
];

test('groundAssertion attaches the matching utterance', () => {
  const ref = groundAssertion('rec1', { subject: 'Maya', object: 'Riverside' }, utts);
  assert.equal(ref.recordingId, 'rec1');
  assert.equal(ref.startMs, 1000);
  assert.equal(ref.excerpt, 'Maya works on the Riverside project.');
});

test('groundAssertion is null when nothing matches', () => {
  const ref = groundAssertion('rec1', { subject: 'Zeus', object: 'Olympus' }, utts);
  assert.equal(ref.startMs, null);
  assert.equal(ref.excerpt, null);
});

test('withVerificationStatus propagates status across every ref', () => {
  const out = withVerificationStatus([{ recordingId: 'rec1', verificationStatus: 'unverified' }], 'verified');
  assert.equal(out[0].verificationStatus, 'verified');
  assert.equal(out[0].recordingId, 'rec1');
});
