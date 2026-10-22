import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userFacingError } from './errors.ts';

test('a missing server setting is said in words, not as a secret name', () => {
  assert.equal(
    userFacingError('Missing secret DEEPGRAM_API_KEY'),
    'The notes could not be made: this server is not set up for transcription yet.',
  );
  assert.equal(userFacingError('Missing secret ANTHROPIC_API_KEY'), userFacingError('Missing secret DEEPGRAM_API_KEY'));
});

test('every other failure keeps its own words', () => {
  assert.equal(userFacingError('The recording was too short to transcribe.'), 'The recording was too short to transcribe.');
  assert.equal(userFacingError('Missing file seg-0002.m4a'), 'Missing file seg-0002.m4a', 'only a missing secret is replaced');
  assert.equal(userFacingError(''), '');
});
