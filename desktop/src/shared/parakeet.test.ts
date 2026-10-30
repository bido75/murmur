import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_MS,
  MODEL_SAMPLE_RATE,
  argmax,
  loadVocab,
  softmaxAt,
  tokensToWords,
  wordsToUtterances,
} from './parakeet.ts';

const WORD_MARK = '▁';

test('the model rate and frame time are the ones the model uses', () => {
  assert.equal(MODEL_SAMPLE_RATE, 16000);
  assert.equal(FRAME_MS, 80, 'a frame is 10 ms of hop, 8 times subsampled');
});

test('the vocabulary is read, and the blank token must be there', () => {
  const vocab = loadVocab('<unk> 0\n<blk> 1\nhello 2\n');
  assert.equal(vocab.tokens[0], '<unk>');
  assert.equal(vocab.tokens[1], '<blk>');
  assert.equal(vocab.tokens[2], 'hello');
  assert.equal(vocab.blank, 1);
  assert.equal(vocab.unknown, 0);
});

test('a vocabulary with no blank token is refused', () => {
  assert.throws(
    () => loadVocab('<unk> 0\nhello 1\n'),
    /missing its blank token/,
  );
});

test('a token that contains a space is read whole', () => {
  // The number is after the last space, so a token with spaces in it still works.
  const vocab = loadVocab('<blk> 0\nnew york 1\n');
  assert.equal(vocab.tokens[1], 'new york');
});

test('the largest number is found', () => {
  assert.equal(argmax(new Float32Array([1, 5, 2]), 3), 1);
  assert.equal(argmax(new Float32Array([-3, -1]), 2), 1);
  assert.equal(argmax(new Float32Array([7]), 1), 0);
});

test('the confidence of a token comes from its logits', () => {
  // One logit much larger than the rest: almost all the weight is on it.
  const confident = softmaxAt(new Float32Array([10, 0, 0]), 0);
  assert.ok(confident > 0.99, `expected near 1, got ${confident}`);
  const unsure = softmaxAt(new Float32Array([0, 0, 0]), 0);
  assert.ok(Math.abs(unsure - 1 / 3) < 1e-6, `expected a third, got ${unsure}`);
});

test('tokens become words, with the times they were said', () => {
  const vocab = loadVocab('<unk> 0\n<blk> 1\nthe 2\n' + WORD_MARK + 'cat 3\n');
  const words = tokensToWords(
    [
      { id: 2, frame: 0, confidence: 0.9 },
      { id: 3, frame: 4, confidence: 0.8 },
    ],
    vocab,
  );
  // The word mark is a prefix, so a token that starts with one begins a new word.
  assert.equal(words.length, 2);
  assert.equal(words[0].text, 'the');
  assert.equal(words[0].start_ms, 0);
  assert.equal(words[0].end_ms, 4 * FRAME_MS);
  assert.equal(words[1].text, 'cat');
  assert.equal(words[1].start_ms, 4 * FRAME_MS);
});

test('a word the model split in two is put back together', () => {
  const vocab = loadVocab(
    '<unk> 0\n<blk> 1\n' + WORD_MARK + 'play 2\ning 3\n',
  );
  const words = tokensToWords(
    [
      { id: 2, frame: 0, confidence: 0.9 },
      { id: 3, frame: 1, confidence: 0.85 },
    ],
    vocab,
  );
  assert.equal(words.length, 1);
  assert.equal(words[0].text, 'playing');
});

test('a word is only as sure as its least sure piece', () => {
  const vocab = loadVocab(
    '<unk> 0\n<blk> 1\n' + WORD_MARK + 'new 2\n' + WORD_MARK + 'york 3\n',
  );
  const words = tokensToWords(
    [
      { id: 2, frame: 0, confidence: 0.95 },
      { id: 3, frame: 2, confidence: 0.4 },
    ],
    vocab,
  );
  // The second token starts a new word, so they are two words, not one.
  assert.equal(words.length, 2);
  assert.equal(words[0].confidence, 0.95);
  assert.equal(words[1].confidence, 0.4);
});

test('a word the model could not spell is left out', () => {
  const vocab = loadVocab('<unk> 0\n<blk> 1\nhello 2\n');
  const words = tokensToWords(
    [
      { id: 0, frame: 0, confidence: 0.1 },
      { id: 2, frame: 1, confidence: 0.9 },
    ],
    vocab,
  );
  assert.equal(words.length, 1);
  assert.equal(words[0].text, 'hello');
});

test('words are grouped into sentences, and the spaces are kept', () => {
  const utterances = wordsToUtterances([
    { text: 'The', start_ms: 0, end_ms: 80, confidence: 1 },
    { text: 'cat', start_ms: 80, end_ms: 160, confidence: 1 },
    { text: 'sat.', start_ms: 160, end_ms: 240, confidence: 1 },
    { text: 'The', start_ms: 400, end_ms: 480, confidence: 1 },
    { text: 'dog', start_ms: 480, end_ms: 560, confidence: 1 },
    { text: 'ran!', start_ms: 560, end_ms: 640, confidence: 1 },
  ]);
  assert.equal(utterances.length, 2);
  assert.equal(utterances[0].text, 'The cat sat.');
  assert.equal(utterances[0].start_ms, 0);
  assert.equal(utterances[0].end_ms, 240);
  assert.equal(utterances[1].text, 'The dog ran!');
  assert.equal(utterances[1].start_ms, 400);
});

test('words with no punctuation are kept with the sentence they belong to', () => {
  const utterances = wordsToUtterances([
    { text: 'One.', start_ms: 0, end_ms: 80, confidence: 1 },
    { text: 'two', start_ms: 80, end_ms: 160, confidence: 1 },
    { text: 'three', start_ms: 160, end_ms: 240, confidence: 1 },
  ]);
  // The full stop ends the first sentence; the words after it are not dropped, they
  // make the sentence they are in.
  assert.equal(utterances.length, 2);
  assert.equal(utterances[0].text, 'One.');
  assert.equal(utterances[1].text, 'two three');
  assert.equal(utterances[1].start_ms, 80);
  assert.equal(utterances[1].end_ms, 240);
});

test('a question mark ends a sentence', () => {
  const utterances = wordsToUtterances([
    { text: 'Why?', start_ms: 0, end_ms: 80, confidence: 1 },
    { text: 'Because.', start_ms: 80, end_ms: 160, confidence: 1 },
  ]);
  assert.equal(utterances.length, 2);
});
