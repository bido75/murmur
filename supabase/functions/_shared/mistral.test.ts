import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSttProvider, mistralUtterances, speakerNumber } from './mistral.ts';

test('Mistral speaker labels are turned into the numbers the rest of the app uses', () => {
  assert.equal(speakerNumber('speaker_1'), 0);
  assert.equal(speakerNumber('speaker_2'), 1);
  assert.equal(speakerNumber('speaker_12'), 11);
  // Nobody was told apart, so there is one speaker.
  assert.equal(speakerNumber(null), 0);
  assert.equal(speakerNumber(undefined), 0);
  assert.equal(speakerNumber(''), 0);
  assert.equal(speakerNumber('speaker_0'), 0);
});

test('Mistral segments become utterances with the times in milliseconds', () => {
  const out = mistralUtterances({
    text: 'The quick brown fox jumps over the lazy dog. The meeting starts at nine.',
    segments: [
      { text: 'The quick brown fox jumps over the lazy dog.', start: 0.1, end: 2.6, speaker_id: 'speaker_1' },
      { text: ' The meeting starts at nine.', start: 3.4, end: 5.1, speaker_id: 'speaker_2' },
    ],
    usage: { prompt_audio_seconds: 5 },
  });
  assert.equal(out.utterances.length, 2);
  assert.deepEqual(out.utterances[0], {
    start_ms: 100,
    end_ms: 2600,
    speaker: 0,
    text: 'The quick brown fox jumps over the lazy dog.',
  });
  assert.equal(out.utterances[1].speaker, 1);
  assert.equal(out.utterances[1].text, 'The meeting starts at nine.');
  assert.equal(out.durationMs, 5100);
});

test('an answer with no segments keeps the whole text rather than losing it', () => {
  const out = mistralUtterances({
    text: 'One long sentence with no segment times.',
    segments: [],
    usage: { prompt_audio_seconds: 12 },
  });
  assert.equal(out.utterances.length, 1);
  assert.equal(out.utterances[0].text, 'One long sentence with no segment times.');
  // The times are filled in from the audio length, so the transcript can still be
  // lined up with the recording.
  assert.equal(out.utterances[0].start_ms, 0);
  assert.equal(out.utterances[0].end_ms, 12000);
  assert.equal(out.durationMs, 12000);
});

test('an empty answer is no transcript, not a broken one', () => {
  assert.deepEqual(mistralUtterances({ text: '   ', segments: [] }).utterances, []);
  assert.deepEqual(mistralUtterances({}).utterances, []);
});

test('segments with no words are dropped, and the language is passed through', () => {
  const out = mistralUtterances({
    segments: [
      { text: '  ', start: 0, end: 1 },
      { text: 'Real words', start: 1, end: 2, speaker_id: null },
    ],
    language: 'fr',
  });
  assert.equal(out.utterances.length, 1);
  assert.equal(out.utterances[0].text, 'Real words');
  assert.equal(out.language, 'fr');
});

test('Mistral is only used when asked for, and never when a redaction is wanted', () => {
  assert.equal(chooseSttProvider('mistral', false), 'mistral');
  assert.equal(chooseSttProvider('MISTRAL', false), 'mistral');
  // The promise of redaction is kept by the engine that can keep it.
  assert.equal(chooseSttProvider('mistral', true), 'deepgram');
  assert.equal(chooseSttProvider('deepgram', false), 'deepgram');
  assert.equal(chooseSttProvider(undefined, false), 'deepgram');
  assert.equal(chooseSttProvider('', false), 'deepgram');
  assert.equal(chooseSttProvider('nonsense', false), 'deepgram');
});
