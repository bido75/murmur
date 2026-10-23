import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyModelDigest } from './transcription_model.ts';
import { DEFAULT_MODEL } from './transcription_model.ts';

test('a digest that matches the published checksum passes', () => {
  const result = verifyModelDigest(DEFAULT_MODEL, DEFAULT_MODEL.sha256);
  assert.equal(result.ok, true);
});

test('a digest that does not match is refused', () => {
  const wrong = '0'.repeat(64);
  const result = verifyModelDigest(DEFAULT_MODEL, wrong);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /not the one we published/);
});

test('a wrong size is caught before the checksum is looked at', () => {
  // The right checksum, the wrong size: the size is the cheap check, so it comes first.
  const result = verifyModelDigest(
    DEFAULT_MODEL,
    DEFAULT_MODEL.sha256,
    DEFAULT_MODEL.sizeBytes - 1,
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /did not finish/);
});

test('the size is checked when it is given, and not when it is not', () => {
  const right = verifyModelDigest(DEFAULT_MODEL, DEFAULT_MODEL.sha256, DEFAULT_MODEL.sizeBytes);
  assert.equal(right.ok, true);
  const noSize = verifyModelDigest(DEFAULT_MODEL, DEFAULT_MODEL.sha256);
  assert.equal(noSize.ok, true);
});
