// The speech models the app can run on the device, and how to tell a good download from a
// broken one. Pure, so it can be tested without a phone.
//
// A model is identified by its id and version. The checksum is the one the file's host
// publishes, so a download that was cut short, or a file that was swapped on the way, is
// caught before it is used.

import { sha256Hex } from './sha256.ts';

export type ModelSpec = {
  /** Stable name of the model family, e.g. "whisper-base". */
  id: string;
  /** The exact build. A newer build is a different model, so it gets its own file. */
  version: string;
  /** What the user sees. */
  label: string;
  /** Where the file is fetched from. */
  url: string;
  /** The SHA-256 the host publishes for this file, in lower-case hex. */
  sha256: string;
  /** The exact size in bytes, so a short download is caught before hashing. */
  sizeBytes: number;
  /** Rough download size for the user, in megabytes. */
  sizeMb: number;
  /** The words to use when telling the user what this model is for. */
  note: string;
  /** Who made it, and under what licence. Shown to the user. */
  attribution: string;
};

/**
 * The speech model the app downloads today: whisper.cpp's base model, quantised to 5-bit.
 * The checksum and size come from the file's host, so they are what the file really is.
 */
export const SPEECH_MODELS: ModelSpec[] = [
  {
    id: 'whisper-base-q5_1',
    version: '20241022',
    label: 'Whisper base (5-bit)',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
    sizeBytes: 59707625,
    sizeMb: 57,
    note: 'Slower and less accurate than the cloud, but the audio never leaves your phone.',
    attribution:
      'Whisper base from OpenAI, converted and quantised by Georgi Gerganov and the whisper.cpp project. Used under the MIT licence.',
  },
];

/** The model the app uses when nothing else is chosen. */
export const DEFAULT_MODEL: ModelSpec = SPEECH_MODELS[0];

/** The model with this id, or the default when the id is unknown or missing. */
export function modelById(id: string | null | undefined): ModelSpec {
  return SPEECH_MODELS.find((m) => m.id === id) ?? DEFAULT_MODEL;
}

/** Where the model is kept on the device. The version is in the name, so two versions can sit side by side. */
export function modelFileName(spec: ModelSpec): string {
  return `${spec.id}-${spec.version}.bin`;
}

/** What we know about a model that is (or is not) on the device. */
export type ModelStatus = {
  /** The model that is expected to be used. */
  spec: ModelSpec;
  /** The file is there. */
  present: boolean;
  /** The file's size in bytes, 0 when it is not there. */
  sizeBytes: number;
  /** The build we have, when we know it. */
  installedVersion: string | null;
  /** The build that was checked and found good. */
  verifiedVersion: string | null;
};

export type ModelState =
  | 'missing' // not downloaded
  | 'downloading' // on the way
  | 'verifying' // downloaded, being checked
  | 'ready' // checked and good
  | 'corrupt' // present but does not match what we published
  | 'outdated'; // a working model, but an older build than we publish

/**
 * Where the model stands.
 *
 * A model counts as ready only when it has been checked against the checksum we published.
 * That check is remembered, so the app does not re-hash 60 MB on every launch.
 */
export function modelState(status: ModelStatus): ModelState {
  if (!status.present || status.sizeBytes <= 0) return 'missing';
  if (status.sizeBytes !== status.spec.sizeBytes) return 'corrupt';
  if (status.verifiedVersion === status.spec.version) return 'ready';
  // The right size but never checked: it has to be checked before it is used.
  if (!status.verifiedVersion) return 'verifying';
  if (status.installedVersion && status.installedVersion !== status.spec.version)
    return 'outdated';
  return 'verifying';
}

/**
 * Check a downloaded file against the model we published.
 *
 * The size is checked first because it is free, and a short download is the common
 * failure. Only then is the whole file hashed.
 */
export function verifyModel(
  spec: ModelSpec,
  bytes: Uint8Array,
): { ok: true } | { ok: false; reason: string } {
  if (bytes.length !== spec.sizeBytes)
    return {
      ok: false,
      reason: `The download is ${bytes.length} bytes but should be ${spec.sizeBytes}. It did not finish.`,
    };
  return verifyModelDigest(spec, sha256Hex(bytes));
}

/**
 * Check a file against the model we published, using a hash that was already computed.
 *
 * This is what the app uses for a large model: the file is read and hashed a piece at a
 * time, so nothing the size of the model is ever held in memory.
 */
export function verifyModelDigest(
  spec: ModelSpec,
  digest: string,
  sizeBytes?: number,
): { ok: true } | { ok: false; reason: string } {
  if (sizeBytes != null && sizeBytes !== spec.sizeBytes)
    return {
      ok: false,
      reason: `The download is ${sizeBytes} bytes but should be ${spec.sizeBytes}. It did not finish.`,
    };
  if (digest !== spec.sha256)
    return {
      ok: false,
      reason: 'The downloaded model is not the one we published, so it was not used.',
    };
  return { ok: true };
}

/** How far a download has got, as a whole percentage between 0 and 100. */
export function progressPercent(bytesWritten: number, totalBytes: number): number {
  if (!totalBytes || totalBytes <= 0) return 0;
  const pct = Math.round((bytesWritten / totalBytes) * 100);
  return Math.max(0, Math.min(100, pct));
}

/** What to tell the user about a model's state. Plain words, no jargon. */
export function modelStateMessage(state: ModelState, spec: ModelSpec): string {
  switch (state) {
    case 'missing':
      return `Download the speech model (${spec.sizeMb} MB) to transcribe on this device.`;
    case 'downloading':
      return 'Downloading the speech model…';
    case 'verifying':
      return 'Checking the speech model…';
    case 'ready':
      return 'The speech model is installed and checked.';
    case 'corrupt':
      return 'The speech model did not download properly. Download it again.';
    case 'outdated':
      return 'A newer speech model is available. Download it to get better notes.';
  }
}

/**
 * Whether a model on the device can be trusted, and why not when it cannot.
 *
 * A model that has never been checked is not refused outright: it is checked the first
 * time it is used, so an install that was interrupted can still finish the job.
 */
export function modelUsable(
  status: ModelStatus,
): { usable: boolean; needsCheck: boolean; reason?: string } {
  const state = modelState(status);
  if (state === 'ready') return { usable: true, needsCheck: false };
  if (state === 'verifying')
    return { usable: true, needsCheck: true };
  if (state === 'corrupt')
    return {
      usable: false,
      needsCheck: false,
      reason: 'The speech model on this device is damaged. Download it again.',
    };
  if (state === 'outdated')
    return {
      usable: false,
      needsCheck: false,
      reason: 'The speech model on this device is out of date. Download the newer one.',
    };
  return {
    usable: false,
    needsCheck: false,
    reason: 'Download the speech model to transcribe on this device.',
  };
}
