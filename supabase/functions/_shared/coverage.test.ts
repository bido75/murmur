import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageRecall, generatedText, normalizeTopic, topicCovered } from './coverage.ts';

test('normalizeTopic lowercases and collapses non-alphanumerics', () => {
  assert.equal(normalizeTopic('  Economic   Collapse!? '), 'economic collapse');
});

test('topicCovered matches a topic inside a longer heading', () => {
  assert.ok(topicCovered('economic collapse', ['Economic Collapse and Global Power Shifts']));
});

test('topicCovered matches a short heading by containment in the topic', () => {
  assert.ok(topicCovered('ancient technology and the pyramids', ['Ancient Technology and the Pyramids']));
});

test('topicCovered does not match unrelated text', () => {
  assert.equal(topicCovered('volcanic eruption', ['Economic Collapse and Global Power Shifts']), false);
});

test('coverageRecall reports matched, missing and recall', () => {
  const r = coverageRecall(
    ['political division', 'economic collapse', 'natural disasters'],
    ['Economic Collapse and Global Power Shifts', 'Natural Disasters and Climate Events'],
  );
  assert.deepEqual(r.matched, ['economic collapse', 'natural disasters']);
  assert.deepEqual(r.missing, ['political division']);
  assert.equal(r.recall, 2 / 3);
});

test('generatedText combines headings, key points and overview', () => {
  const t = generatedText(['AI Crisis'], ['a key point'], 'an overview');
  assert.equal(t.length, 3);
  assert.ok(t.includes('AI Crisis'));
});