import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIDENCE_THRESHOLD,
  addEntry,
  applyDictionary,
  editDistance,
  formatDictionaryFile,
  maxEditDistance,
  parseDictionaryFile,
  removeEntry,
  sortedEntries,
  validateEntry,
  wordsWithConfidence,
} from './dictionary.ts';

test('a word is checked before it is added', () => {
  assert.equal(validateEntry("Anthropic").ok, true);
  assert.equal(validateEntry("New York").ok, true);
  assert.equal(validateEntry("").ok, false);
  assert.equal(validateEntry("Acme2").ok, false, "numbers are not supported");
  assert.match(validateEntry("Acme2").reason ?? "", /Numbers/);
  assert.equal(validateEntry("one two three").ok, false);
});

test('the same word is not added twice', () => {
  let entries = addEntry([], "Anthropic").entries;
  const again = addEntry(entries, "anthropic");
  assert.equal(again.added, false);
  assert.match(again.reason ?? "", /already/);
  entries = again.entries;
  assert.equal(entries.length, 1);
});

test('a word is taken out by its name in any case', () => {
  const entries = addEntry([], "Anthropic").entries;
  assert.equal(removeEntry(entries, "anthropic").length, 0);
  assert.equal(removeEntry(entries, "ANTHROPIC").length, 0);
});

test('the words are shown in order, ignoring case', () => {
  const entries = addEntry(addEntry([], "zebra").entries, "Apple").entries;
  assert.deepEqual(
    sortedEntries(entries).map((e) => e.word),
    ["Apple", "zebra"],
  );
});

test('how far two words are apart is worked out', () => {
  assert.equal(editDistance("cat", "cat"), 0);
  assert.equal(editDistance("cat", "cot"), 1);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
});

test('a short word has to match exactly, a long one may be a letter out', () => {
  assert.equal(maxEditDistance("cat"), 0);
  assert.equal(maxEditDistance("abcd"), 1);
  assert.equal(maxEditDistance("abcdefgh"), 2);
});

test('a word the model was sure about is left alone', () => {
  const entries = [{ word: "Katherine" }];
  const out = applyDictionary(
    [{ text: "Catherine", confidence: 0.95 }],
    entries,
  );
  assert.equal(
    out[0].text,
    "Catherine",
    "a confident word is what was said, so it is not changed",
  );
});

test('a word the model was unsure about is matched against the dictionary', () => {
  const entries = [{ word: "Katherine" }];
  const out = applyDictionary(
    [{ text: "Cathrine", confidence: 0.2 }],
    entries,
  );
  assert.equal(out[0].text, "Katherine");
});

test('an exact match always gets the dictionary spelling', () => {
  const entries = [{ word: "anthropic" }];
  const out = applyDictionary(
    [{ text: "Anthropic", confidence: 0.99 }],
    entries,
  );
  assert.equal(out[0].text, "anthropic", "the capitalisation is put right");
});

test('a word that is nothing like anything in the dictionary is left alone', () => {
  const entries = [{ word: "Katherine" }];
  const out = applyDictionary(
    [
      { text: "completely", confidence: 0.1 },
      { text: "different", confidence: 0.1 },
    ],
    entries,
  );
  assert.equal(out[0].text, "completely");
  assert.equal(out[1].text, "different");
  assert.equal(out[0].confidence, 0.1);
});

test('the confidence threshold is the one the model needs', () => {
  assert.ok(CONFIDENCE_THRESHOLD > 0 && CONFIDENCE_THRESHOLD < 1);
});

test('a passage is split into words with the confidence of each', () => {
  const words = wordsWithConfidence([
    { text: "front-end", confidence: 0.8 },
    { text: "don't", confidence: 0.7 },
  ]);
  assert.deepEqual(
    words.map((w) => w.text),
    ["front", "end", "don", "t"],
  );
});

test('a dictionary can be read from a file and written back out', () => {
  const { entries, skipped } = parseDictionaryFile(
    "Anthropic\nAcme2\n\nanthropic\nNew York\n",
  );
  assert.equal(entries.length, 2, "the duplicate and the bad word are left out");
  assert.deepEqual(skipped, ["Acme2"]);
  assert.equal(formatDictionaryFile(entries), "Anthropic\nNew York");
});
