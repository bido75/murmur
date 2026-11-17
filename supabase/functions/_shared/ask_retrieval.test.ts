import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askKeywords, relevantLines } from './ask_retrieval.ts';
import type { Utterance } from './verify.ts';

test('askKeywords drops stopwords and keeps meaningful words', () => {
  assert.deepEqual(askKeywords('What did we decide about the budget?'), ['decide', 'budget']);
  assert.deepEqual(askKeywords('When is the crane arriving on site'), ['crane', 'arriving', 'site']);
});

test('askKeywords returns nothing for a stopword-only question', () => {
  assert.deepEqual(askKeywords('what did we do'), []);
});

test('relevantLines keeps a matching line and one line of context', () => {
  const u: Utterance[] = [
    { start_ms: 0, end_ms: 1000, speaker: 0, text: 'Morning everyone.' },
    { start_ms: 2000, end_ms: 3000, speaker: 1, text: 'The crane arrives Monday.' },
    { start_ms: 4000, end_ms: 5000, speaker: 0, text: 'Good, we can start.' },
  ];
  const out = relevantLines(u, ['crane'], { 1: 'Maya' });
  assert.match(out, /crane arrives Monday/);
  assert.match(out, /Morning everyone\./, 'context line before');
  assert.match(out, /Maya:/, 'speaker name used');
});

test('relevantLines without words returns the first lines as a transcript', () => {
  const u: Utterance[] = [{ start_ms: 0, end_ms: 1000, speaker: 0, text: 'Hi there.' }];
  assert.match(relevantLines(u, [], {}), /\[0:00\] Speaker 1: Hi there\./);
});
