import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allow, slidingWindow } from './agent_rate_limit.ts';

test('slidingWindow keeps only events after the cutoff', () => {
  const now = 1_000_000;
  const events = [now - 5000, now - 1000, now - 200_000]; // third is out of a 10s window
  const { inWindow, oldest } = slidingWindow(events, now, 10_000);
  assert.equal(inWindow, 2);
  assert.equal(oldest, now - 5000);
});

test('allow permits under the limit and reports count', () => {
  const now = 1_000_000;
  const d = allow([now - 1000, now - 2000], now, { max: 5, windowMs: 60_000 });
  assert.equal(d.allowed, true);
  assert.equal(d.count, 2);
  assert.equal(d.retryAfterMs, 0);
});

test('allow blocks at the limit and gives a retry-after', () => {
  const now = 1_000_000;
  const d = allow([now - 1000, now - 2000, now - 3000], now, { max: 3, windowMs: 60_000 });
  assert.equal(d.allowed, false);
  assert.equal(d.count, 3);
  assert.ok(d.retryAfterMs > 0);
});

test('empty history is always allowed', () => {
  assert.equal(allow([], Date.now(), { max: 1, windowMs: 60_000 }).allowed, true);
});
