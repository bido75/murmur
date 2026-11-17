import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  factualFaithfulness,
  semanticRecall,
  splitForJudgement,
} from './semantic.ts';

test('semanticRecall weights partial as half credit', () => {
  const r = semanticRecall([
    { verdict: 'covered' },
    { verdict: 'covered' },
    { verdict: 'partial' },
    { verdict: 'not_covered' },
  ]);
  assert.equal(r.covered, 2);
  assert.equal(r.partial, 1);
  assert.equal(r.not_covered, 1);
  assert.equal(r.total, 4);
  assert.equal(r.recall, (2 + 0.5) / 4);
});

test('semanticRecall is 1 when there is nothing to judge', () => {
  assert.equal(semanticRecall([]).recall, 1);
});

test('factualFaithfulness counts unsupported as failures', () => {
  const r = factualFaithfulness([
    { verdict: 'supported' },
    { verdict: 'supported' },
    { verdict: 'partially_supported' },
    { verdict: 'unsupported' },
  ]);
  assert.equal(r.supported, 2);
  assert.equal(r.partially_supported, 1);
  assert.equal(r.unsupported, 1);
  assert.equal(r.faithfulness, (2 + 0.5) / 4);
});

test('splitForJudgement does not split short text', () => {
  assert.deepEqual(splitForJudgement('abc', 10), ['abc']);
});

test('splitForJudgement splits long text on line boundaries', () => {
  const text = Array.from({ length: 6 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
  const chunks = splitForJudgement(text, 30);
  assert.ok(chunks.length > 1);
  // every chunk stays within a couple characters of the cap (which is 30 here)
  assert.ok(chunks.every((c) => c.length <= 36));
  // every line of the source lives in exactly one chunk
  assert.ok(text.split('\n').every((line) => chunks.some((c) => c.includes(line.trim()))));
});