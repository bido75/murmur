import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvidence, compareCommitments, meetingBriefMaterial } from './agent_meeting.ts';

test('human-verified evidence is source_backed', () => {
  assert.deepEqual(classifyEvidence({ verificationStatus: 'verified' }), { kind: 'source_backed', reason: 'human-verified' });
});

test('a quote-grounded claim is source_backed', () => {
  assert.deepEqual(classifyEvidence({ verified: true, quote: 'Say hi' }), { kind: 'source_backed', reason: 'quote found in transcript' });
});

test('a floated suggestion is speaker_opinion, even if verified', () => {
  assert.deepEqual(classifyEvidence({ kind: 'suggestion', verified: false, quote: 'maybe do x' }), { kind: 'speaker_opinion', reason: 'floated, not committed' });
});

test('needs_review and rejected are unresolved_claim', () => {
  assert.equal(classifyEvidence({ needs_review: true }).kind, 'unresolved_claim');
  assert.equal(classifyEvidence({ verificationStatus: 'rejected' }).kind, 'unresolved_claim');
  assert.equal(classifyEvidence({ verificationStatus: 'unverified' }).kind, 'unresolved_claim');
});

test('no supporting quote is unanchored', () => {
  assert.equal(classifyEvidence({ verified: false, quote: null }).kind, 'unanchored');
});

test('compareCommitments resolves by ref', () => {
  const priors = [{ text: 'Ship prototype', ref: 'T1' }, { text: 'Order anchors', ref: 'T2' }, { text: 'Call client', ref: 'T3' }];
  const updates = [
    { ref: 'T1', status: 'done' as const },
    { ref: 'T2', status: 'blocked' as const, note: 'waiting on supplier' },
  ];
  const out = compareCommitments(priors, updates);
  assert.equal(out[0].outcome, 'done');
  assert.equal(out[1].outcome, 'blocked');
  assert.equal(out[1].note, 'waiting on supplier');
  assert.equal(out[2].outcome, 'unchanged');
});

test('meetingBriefMaterial keeps only verified decisions and caps lists', () => {
  const input = {
    openTasks: Array.from({ length: 50 }, (_, i) => ({ text: `task ${i}` })),
    decisions: [{ text: 'Use Hilti', verified: true }, { text: 'maybe plasti', verified: false }],
    questions: ['q1', 'q2'],
    lastOverview: 'Last call covered the site walk.',
  };
  const out = meetingBriefMaterial(input, { tasks: 40, decisions: 20, questions: 20 });
  assert.equal(out.counts.openTasks, 40);
  assert.equal(out.counts.decisions, 1);
  assert.equal(out.counts.questions, 2);
  assert.match(out.material, /Use Hilti/);
  assert.doesNotMatch(out.material, /maybe plasti/);
  assert.match(out.material, /Last call covered the site walk\./);
});
