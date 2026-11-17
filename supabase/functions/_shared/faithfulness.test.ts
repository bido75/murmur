import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranscriptIndex,
  findQuote,
  normalizeForSearch,
  summarizeFaithfulness,
  verifySectionQuotes,
} from './faithfulness.ts';

const utts = [
  { text: 'From all sides by those in power.', start_ms: 0, end_ms: 4200, speaker: 0 },
  { text: 'She said he would rise again in 2025.', start_ms: 21400, end_ms: 25000, speaker: 0 },
  { text: 'Massive changes and economic collapse.', start_ms: 26000, end_ms: 29000, speaker: 0 },
];

test('normalizeForSearch folds case, punctuation, quotes and dashes', () => {
  assert.equal(normalizeForSearch('  “Rise — again” in 2025?!  '), 'rise again in 2025');
});

test('normalizeForSearch keeps non-English letters and digits, drops symbols', () => {
  assert.equal(normalizeForSearch('Día 3: Gräberstraße № 7'), 'día 3 gräberstraße 7');
});

test('findQuote grounds a verbatim quote and returns the right timestamp', () => {
  const idx = buildTranscriptIndex(utts);
  const m = findQuote('she said he would rise again in 2025', idx);
  assert.ok(m);
  assert.equal(m.start_ms, 21400);
});

test('findQuote matches across cleaned punctuation', () => {
  const idx = buildTranscriptIndex(utts);
  const m = findQuote('From ALL sides by those in power', idx);
  assert.ok(m);
  assert.equal(m.start_ms, 0);
});

test('findQuote returns null for a quote that is not in the transcript (paraphrase)', () => {
  const idx = buildTranscriptIndex(utts);
  assert.equal(findQuote('he would return stronger than ever', idx), null);
});

test('findQuote refuses a too-short quote as non-distinctive', () => {
  const idx = buildTranscriptIndex(utts);
  assert.equal(findQuote('in 2025', idx), null); // 7 chars, just under the 8-char floor
  assert.equal(findQuote('hi', idx), null);
});

test('verifySectionQuotes reports grounded vs ungrounded and timestamp drift', () => {
  const sections = [
    { heading: 'Grounded', quote: 'She said he would rise again in 2025.', quote_ms: 21400 },
    { heading: 'Misfiled', quote: 'Massive changes and economic collapse.', quote_ms: 99000 },
    { heading: 'Invented', quote: 'The president said he would never leave office.', quote_ms: 120000 },
    { heading: 'No quote', quote: null },
  ];
  const verdicts = verifySectionQuotes(sections, utts);
  assert.equal(verdicts[0].grounded, true);
  assert.equal(verdicts[0].drift_ms, 0);
  assert.equal(verdicts[1].grounded, true);
  assert.equal(verdicts[1].drift_ms, Math.abs(26000 - 99000));
  assert.equal(verdicts[2].grounded, false);
  assert.equal(verdicts[3].has_quote, false);
});

test('summarizeFaithfulness aggregates grounding and drift', () => {
  const verdicts = verifySectionQuotes(
    [
      { heading: 'A', quote: 'She said he would rise again in 2025.', quote_ms: 21400 },
      { heading: 'B', quote: 'Massive changes and economic collapse.', quote_ms: 26000 },
      { heading: 'C', quote: 'Never spoken anywhere in this transcript.', quote_ms: 0 },
    ],
    utts,
  );
  const f = summarizeFaithfulness(verdicts);
  assert.equal(f.total_quotes, 3);
  assert.equal(f.grounded, 2);
  assert.equal(f.ungrounded, 1);
  assert.equal(f.grounded_pct, 2 / 3);
  assert.equal(f.drift_ms_mean, 0);
  assert.equal(f.drift_ms_max, 0);
  assert.deepEqual(f.ungrounded_headings, ['C']);
});