import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeQuery, utteranceCitations, rankSearchHits, insufficientEvidence, contradicts, sourceRef, contentTerms, filterAndRankByTerms } from './agent_retrieval.ts';
import type { Utterance } from './verify.ts';

const utts: Utterance[] = [
  { start_ms: 0, end_ms: 4000, speaker: 0, text: 'We should order the Hilti anchors this week.' },
  { start_ms: 5000, end_ms: 9000, speaker: 1, text: 'The crane arrives on Monday, not Tuesday.' },
  { start_ms: 10000, end_ms: 14000, speaker: 0, text: 'Let us finalize the budget by Friday.' },
];

test('contentTerms drops stopwords and dedupes', () => {
  assert.deepEqual(contentTerms('the crane and the crane'), ['crane']);
});

test('decomposeQuery splits multi-part questions', () => {
  const parts = decomposeQuery('Which anchors did we pick, and when does the crane arrive?');
  assert.equal(parts.length, 2);
  assert.ok(parts[0].includes('anchors') || parts[0].includes('pick'));
  assert.ok(parts[1].includes('crane') || parts[1].includes('arrive'));
});

test('utteranceCitations returns ranked timestamped matches', () => {
  const cits = utteranceCitations(utts, ['crane', 'monday'], { 1: 'Ava' });
  assert.equal(cits.length, 1);
  assert.equal(cits[0].start_ms, 5000);
  assert.equal(cits[0].speaker, 'Ava');
  assert.equal(cits[0].score, 1);
});

test('utteranceCitations scores partial matches below full matches', () => {
  const cits = utteranceCitations(utts, ['crane', 'budget']);
  assert.equal(cits[0].start_ms, 5000); // 'crane' only -> 0.5, but budget utterance is 10000
  // both have score 0.5; sort falls back to start_ms asc
  assert.equal(cits.length, 2);
});

test('insufficientEvidence is true when nothing clears the bar', () => {
  assert.equal(insufficientEvidence([], 0.5), true);
  assert.equal(insufficientEvidence([{ start_ms: 0, end_ms: 1, excerpt: 'x', speaker: 'S1', score: 0.2 }], 0.5), true);
  assert.equal(insufficientEvidence([{ start_ms: 0, end_ms: 1, excerpt: 'x', speaker: 'S1', score: 0.6 }], 0.5), false);
});

test('rankSearchHits reranks by relevance and keeps ties stable', () => {
  const hits = [
    { recording_id: 'a', title: 'unrelated', snippet: 'noise' },
    { recording_id: 'b', title: 'site', snippet: 'crane arrives monday' },
  ];
  const ranked = rankSearchHits(hits, ['crane', 'monday']);
  assert.equal(ranked[0].recording_id, 'b');
  assert.equal(ranked[0].score, 1);
});

test('contradicts is conservative and negation-aware', () => {
  assert.equal(contradicts('The crane arrives on Monday', 'The crane does not arrive on Monday'), true);
  assert.equal(contradicts('The crane arrives on Monday', 'The crane arrives on Monday'), false); // no negation
  assert.equal(contradicts('The crane arrives on Monday', 'We will cancel the crane arrival'), true);
  assert.equal(contradicts('Apples are red', 'The budget is due Friday'), false); // no shared terms
});

test('sourceRef carries recording, timestamp and excerpt', () => {
  const ref = sourceRef('rec1', { start_ms: 5000, end_ms: 9000, excerpt: 'The crane…', speaker: 'Ava', score: 1 });
  assert.deepEqual(ref, { recordingId: 'rec1', startMs: 5000, endMs: 9000, excerpt: 'The crane…', verificationStatus: 'unverified' });
});

test('filterAndRankByTerms keeps matching items, ranks by coverage, caps', () => {
  const items = [
    { subject: 'Maya', predicate: 'works_on', object: 'Riverside' },
    { subject: 'Crane', predicate: 'arrives', object: 'Monday' },
  ];
  const out = filterAndRankByTerms(items, ['crane', 'monday'], (i) => `${i.subject} ${i.predicate} ${i.object}`, 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].subject, 'Crane');
  assert.equal(filterAndRankByTerms(items, ['zeus'], (i) => i.subject, 10).length, 0);
});
