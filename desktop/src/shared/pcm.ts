// Turning recorded audio into the form a speech model can read.
//
// The desktop app records WebM. A speech model wants one channel of samples at a fixed
// rate — 16 kHz for Parakeet. The renderer decodes the WebM with the browser's own
// audio tools and sends plain numbers over; these helpers do the arithmetic, and are
// plain functions so they can be tested without a microphone.
//
// Nothing here touches the network or the disk.

/** The rate a speech model is fed at. */
export const MODEL_SAMPLE_RATE = 16000;

/** How long the audio is, in milliseconds. */
export function pcmDurationMs(
  samples: Float32Array | number[],
  sampleRate: number,
): number {
  if (!sampleRate || samples.length === 0) return 0;
  return Math.round((samples.length / sampleRate) * 1000);
}

/**
 * Resample to another rate with linear interpolation.
 *
 * A fallback for when the browser cannot do it: the renderer normally uses
 * `OfflineAudioContext`, which resamples properly. Linear interpolation is good enough
 * for speech and is exact for a signal that is already at the target rate.
 */
export function resampleLinear(
  samples: Float32Array | number[],
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!fromRate || !toRate) return new Float32Array(0);
  if (fromRate === toRate) return Float32Array.from(samples);
  if (samples.length === 0) return new Float32Array(0);

  const ratio = toRate / fromRate;
  const outLength = Math.max(1, Math.round(samples.length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const position = i / ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    out[i] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return out;
}

/**
 * Take one channel of a decoded recording at the model's rate.
 *
 * The renderer does the decoding and resampling with the browser's own audio tools when
 * it can; this is the fallback and the path used by the tests.
 */
export function toModelSamples(
  channels: Float32Array[],
  sampleRate: number,
): Float32Array {
  if (!channels.length) return new Float32Array(0);
  // More than one channel: mix them down, so a stereo recording is not half heard.
  if (channels.length === 1)
    return resampleLinear(channels[0], sampleRate, MODEL_SAMPLE_RATE);
  const length = Math.min(...channels.map((c) => c.length));
  const mixed = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mixed[i] += channel[i];
  }
  for (let i = 0; i < length; i++) mixed[i] /= channels.length;
  return resampleLinear(mixed, sampleRate, MODEL_SAMPLE_RATE);
}

/**
 * The loudest sample in the audio, from 0 to 1.
 *
 * Used to notice a recording that is silent — a muted microphone, or a part that was
 * cut short — before it is sent to the model.
 */
export function peakLevel(samples: Float32Array | number[]): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return Math.min(1, peak);
}

/**
 * Whether the audio is so quiet that it is probably not speech.
 *
 * The threshold is low on purpose: a quiet meeting is still a meeting. It is there to
 * catch a muted microphone, not to judge the recording.
 */
export function isSilent(
  samples: Float32Array | number[],
  threshold = 0.002,
): boolean {
  if (samples.length === 0) return true;
  return peakLevel(samples) < threshold;
}
