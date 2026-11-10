import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLive } from './liveMerge.ts';

test('a provisional line is replaced by its finalized text, not duplicated', () => {
  const a = mergeLive([], 'the crane', false);
  assert.deepEqual(a, [{ text: 'the crane', final: false }]);
  const b = mergeLive(a, 'the crane arrives', true);
  assert.deepEqual(b, [{ text: 'the crane arrives', final: true }]);
});

test('finalized lines accumulate and provisional tails are dropped', () => {
  let l = mergeLive([], 'hello', true);
  l = mergeLive(l, 'world', false);
  l = mergeLive(l, 'world today', true);
  assert.deepEqual(l, [
    { text: 'hello', final: true },
    { text: 'world today', final: true },
  ]);
});

test('empty text leaves the lines unchanged', () => {
  const l = mergeLive([], 'hello', true);
  assert.deepEqual(mergeLive(l, '   ', false), l);
});

test('the window is capped to max lines', () => {
  let l: { text: string; final: boolean }[] = [];
  for (let i = 0; i < 20; i++) l = mergeLive(l, `line ${i}`, true, 5);
  assert.equal(l.length, 5);
  assert.equal(l[4].text, 'line 19');
});
