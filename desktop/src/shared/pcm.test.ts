import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_SAMPLE_RATE,
  isSilent,
  pcmDurationMs,
  peakLevel,
  resampleLinear,
  toModelSamples,
} from './pcm.ts';

test('the length of the audio is worked out from the number of samples', () => {
  assert.equal(pcmDurationMs(new Float32Array(16000), 16000), 1000);
  assert.equal(pcmDurationMs(new Float32Array(48000), 48000), 1000);
  assert.equal(pcmDurationMs(new Float32Array(0), 16000), 0);
  assert.equal(pcmDurationMs(new Float32Array(100), 0), 0);
});

test('resampling to the same rate changes nothing', () => {
  const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
  const out = resampleLinear(samples, 16000, 16000);
  assert.deepEqual(Array.from(out), Array.from(samples));
});

test('resampling halves the number of samples when the rate is halved', () => {
  const samples = new Float32Array(1000).fill(0.5);
  const out = resampleLinear(samples, 32000, 16000);
  assert.equal(out.length, 500);
  assert.ok(Math.abs(out[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(out[499] - 0.5) < 1e-6);
});

test('resampling interpolates between the samples it has', () => {
  const samples = new Float32Array([0, 1]);
  const out = resampleLinear(samples, 1000, 2000);
  // Two samples at 1000 Hz become four at 2000 Hz: the original, the midpoint, the
  // original again, and then the edge held where there is nothing beyond it.
  assert.equal(out.length, 4);
  assert.ok(Math.abs(out[0] - 0) < 1e-6);
  assert.ok(Math.abs(out[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(out[2] - 1) < 1e-6);
  assert.ok(Math.abs(out[3] - 1) < 1e-6);
});

test('resampling nothing gives nothing', () => {
  assert.equal(resampleLinear(new Float32Array(0), 48000, 16000).length, 0);
  assert.equal(resampleLinear(new Float32Array(10), 0, 16000).length, 0);
});

test('one channel is resampled to the rate the model wants', () => {
  const samples = new Float32Array(48000).fill(0.25);
  const out = toModelSamples([samples], 48000);
  assert.equal(out.length, MODEL_SAMPLE_RATE);
  assert.ok(Math.abs(out[0] - 0.25) < 1e-6);
});

test('two channels are mixed down, so both sides are heard', () => {
  const left = new Float32Array(16000).fill(0.5);
  const right = new Float32Array(16000).fill(-0.5);
  const out = toModelSamples([left, right], 16000);
  assert.equal(out.length, 16000);
  // The two sides cancel: the average is zero.
  assert.ok(Math.abs(out[0]) < 1e-6);
});

test('the loudest sample is found', () => {
  // Float32 numbers are not exact, so the answer is compared with a little room.
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);
  close(peakLevel(new Float32Array([0.1, -0.9, 0.3])), 0.9);
  close(peakLevel(new Float32Array([0.5, 0.2])), 0.5);
  close(peakLevel(new Float32Array(0)), 0);
});

test('silence is noticed, but a quiet meeting is not', () => {
  assert.equal(isSilent(new Float32Array(1000)), true, 'nothing at all is silence');
  assert.equal(isSilent(new Float32Array(1000)), true, 'flat silence is silence');
  assert.equal(
    isSilent(new Float32Array([0, 0.0001, 0])),
    true,
    'almost nothing is silence',
  );
  assert.equal(
    isSilent(new Float32Array([0, 0.05, 0])),
    false,
    'a quiet recording is still a recording',
  );
});
