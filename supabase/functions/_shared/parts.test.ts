import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryExcerpt, joinParts, mapLimited, mergeChannels, parseSpeakerMap, sttCacheKey } from './parts.ts';
import { deepgramParams } from './stt.ts';

const u = (start: number, speaker: number, text: string) => ({ start_ms: start, end_ms: start + 1000, speaker, text });

test('two-channel recordings: my mic is speaker 0, others numbered after', () => {
  const m = mergeChannels([
    { start_ms: 5000, end_ms: 6000, speaker: 1, channel: 1, text: 'Sounds good' },
    { start_ms: 1000, end_ms: 2000, speaker: 0, channel: 0, text: 'Hi all' },
    { start_ms: 3000, end_ms: 4000, speaker: 0, channel: 1, text: 'Hello' },
  ]);
  assert.deepEqual(m.map((x) => [x.speaker, x.text]), [[0, 'Hi all'], [1, 'Hello'], [2, 'Sounds good']]);
  assert.equal(deepgramParams({ multichannel: true }).get('multichannel'), 'true');
  assert.equal(deepgramParams({}).get('multichannel'), null);
});

test('speakers keep one number across parts; bad matches never merge two people', () => {
  const parts = [
    [u(0, 0, 'Morning'), u(2000, 1, 'Hi')],
    [u(0, 1, 'Where were we'), u(2000, 0, 'Level two'), u(4000, 2, 'New person')],
    [u(0, 0, 'Wrapping up')],
  ];
  // Part 2: B1 was A0, B0 was A1, B2 is new. Part 3: B0 was part 2's B2.
  const joined = joinParts(parts, [{ 1: 0, 0: 1, 2: null }, { 0: 2 }]);
  assert.deepEqual(joined[1].map((x) => x.speaker), [0, 1, 2]);
  assert.deepEqual(joined[2].map((x) => x.speaker), [2]);
  // Two locals claiming the same earlier speaker: only the first gets it.
  const clash = joinParts([[u(0, 0, 'a')], [u(0, 0, 'b'), u(1, 1, 'c')]], [{ 0: 0, 1: 0 }]);
  assert.deepEqual(clash[1].map((x) => x.speaker), [0, 1]);
  assert.deepEqual(parseSpeakerMap([{ b: 0, a: 1 }, { b: 1, a: 1 }, { b: 7, a: 0 }, { b: 2, a: 9 }], [0, 1, 2], [0, 1]), { 0: 1, 1: null, 2: null });
});

test('excerpts around a join, cache keys and limited concurrency', async () => {
  const ex = boundaryExcerpt([u(0, 0, 'old'), u(400_000, 1, 'end of part')], [u(0, 0, 'start of next'), u(500_000, 1, 'later')]);
  assert.equal(ex.before, '[A1] end of part');
  assert.equal(ex.after, '[B0] start of next');
  assert.equal(sttCacheKey({ keyterms: ['b', 'a'], language: null, redact: ['pii'], multichannel: false, model: 'nova-3' }), sttCacheKey({ keyterms: ['a', 'b'], language: null, redact: ['pii'], multichannel: false, model: 'nova-3' }));
  let running = 0;
  let peak = 0;
  const out = await mapLimited([1, 2, 3, 4, 5, 6], 2, async (x) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return x * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2);
});
