import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HISTORY,
  addEntry,
  clearHistory,
  entryText,
  removeEntry,
  searchHistory,
  wordCount,
  type HistoryEntry,
} from './history.ts';

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'a',
    at: 1_000_000,
    text: 'the meeting is at nine',
    tookMs: 1200,
    provider: 'parakeet',
    local: true,
    ...over,
  };
}

test('a dictation is added, newest first', () => {
  const history = addEntry(addEntry([], entry({ id: 'a' })), entry({ id: 'b', at: 2_000_000 }));
  assert.equal(history.length, 2);
  assert.equal(history[0].id, 'b', 'the newest is first');
});

test('nothing is added without any words', () => {
  const history = addEntry([], entry({ text: '   ' }));
  assert.equal(history.length, 0);
});

test('the same words twice in a row are one entry', () => {
  // Holding the key down should not fill the history with the same thing.
  const once = addEntry([], entry({ id: 'a', at: 1_000_000 }));
  const twice = addEntry(once, entry({ id: 'b', at: 1_001_000 }));
  assert.equal(twice.length, 1, 'the same words straight after are not a new entry');
  const later = addEntry(twice, entry({ id: 'c', at: 1_030_000 }));
  assert.equal(later.length, 2, 'the same words later are a new entry');
});

test('the oldest goes when there are too many', () => {
  let history: HistoryEntry[] = [];
  for (let i = 0; i < MAX_HISTORY + 5; i++)
    history = addEntry(history, entry({ id: `e${i}`, at: i * 10_000, text: `words ${i}` }));
  assert.equal(history.length, MAX_HISTORY);
  assert.equal(history[0].id, `e${MAX_HISTORY + 4}`, 'the newest is kept');
  assert.ok(!history.some((e) => e.id === 'e0'), 'the oldest is dropped');
});

test('one entry can be taken out', () => {
  const history = addEntry(
    addEntry([], entry({ id: 'a', text: 'the first thing' })),
    entry({ id: 'b', text: 'the second thing' }),
  );
  assert.equal(history.length, 2);
  assert.equal(removeEntry(history, 'a').length, 1);
  assert.equal(removeEntry(history, 'a')[0].id, 'b');
});

test('the history can be cleared', () => {
  assert.equal(clearHistory().length, 0);
});

test('the history can be searched', () => {
  const history = [
    entry({ id: 'a', text: 'the meeting is at nine' }),
    entry({ id: 'b', text: 'the budget is settled' }),
  ];
  assert.equal(searchHistory(history, 'budget').length, 1);
  assert.equal(searchHistory(history, 'BUDGET').length, 1, 'the search ignores the case');
  assert.equal(searchHistory(history, 'meeting').length, 1);
  assert.equal(searchHistory(history, 'nothing here').length, 0);
  assert.equal(searchHistory(history, '').length, 2, 'an empty search shows everything');
  assert.equal(searchHistory(history, '   ').length, 2);
});

test('the words are counted', () => {
  assert.equal(wordCount(entry({ text: 'one two three' })), 3);
  assert.equal(wordCount(entry({ text: '  one  two  ' })), 2);
  assert.equal(wordCount(entry({ text: '' })), 0);
});

test('the text that goes on the clipboard is trimmed', () => {
  assert.equal(entryText(entry({ text: '  hello  ' })), 'hello');
});
