// The speech models the desktop app can run on this computer, and how to tell a good
// download from a broken one.
//
// A local model is a bundle of files rather than one: the Parakeet encoder, decoder and
// joiner, plus the tokens they read. Each file is checked against the size and the
// SHA-256 published by the file's host, so a download that was cut short, or a file that
// was swapped on the way, is caught before it is used.
//
// Pure, so it can be tested without Electron.

/** One file of a speech model. */
export type SpeechModelFile = {
  /** The file's name inside the model folder. */
  name: string;
  /** Where the file is fetched from. */
  url: string;
  /** The SHA-256 the host publishes for this file, in lower-case hex. */
  sha256: string;
  /** The exact size in bytes, so a short download is caught before it is hashed. */
  sizeBytes: number;
};

/** A model the app can install and run. */
export type SpeechModelBundle = {
  id: string;
  /** The exact build. A newer build is a different model, so it gets its own folder. */
  version: string;
  /** What the user sees. */
  label: string;
  /** The words to use when telling the user what this model is for. */
  note: string;
  /** The files that make up the model. */
  files: SpeechModelFile[];
  /** The languages the model knows. */
  languages: string[];
};

/**
 * Parakeet TDT 0.6B v3, quantised to 8-bit and exported to ONNX.
 *
 * The model weights are published under CC BY 4.0, so they may be used and
 * redistributed with attribution. No source code from the project this was modelled on
 * is used: that code is AGPL-3.0 and none of it was copied.
 *
 * The checksums and sizes are the ones the file's host publishes.
 */
export const PARAKEET_TDT_06B_V3: SpeechModelBundle = {
  id: 'parakeet-tdt-0.6b-v3-int8',
  version: '20260101',
  label: 'Parakeet TDT 0.6B v3 (8-bit)',
  note: 'Runs on this computer. The audio never leaves it. About 700 MB to download.',
  languages: ['en'],
  files: [
    {
      name: 'encoder.onnx',
      url: 'https://huggingface.co/fcreait/parakeet-tdt-0.6b-v3-int8-onnx/resolve/main/encoder.onnx',
      sha256: '4cbf4dfc2bd2c4a565609ef373925ad09cb55250c19d7e25f7893be49d5cb5f7',
      sizeBytes: 653979575,
    },
    {
      name: 'decoder.onnx',
      url: 'https://huggingface.co/fcreait/parakeet-tdt-0.6b-v3-int8-onnx/resolve/main/decoder.onnx',
      sha256: 'd593cdb0e571f5a457ec2219af9968cbf6b0e8198e8f7839b40a8754593bf68c',
      sizeBytes: 47233743,
    },
    {
      name: 'joiner.onnx',
      url: 'https://huggingface.co/fcreait/parakeet-tdt-0.6b-v3-int8-onnx/resolve/main/joiner.onnx',
      sha256: 'b9b0bcf88ac571902e69a6536223ed2d94885e981b85045410f1403d53121a63',
      sizeBytes: 25286330,
    },
    {
      name: 'tokens.txt',
      url: 'https://huggingface.co/fcreait/parakeet-tdt-0.6b-v3-int8-onnx/resolve/main/tokens.txt',
      sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
      sizeBytes: 93939,
    },
  ],
};

/** The models the app knows about. */
export const SPEECH_MODELS: SpeechModelBundle[] = [PARAKEET_TDT_06B_V3];

/** The model the app installs by default. */
export const DEFAULT_SPEECH_MODEL = PARAKEET_TDT_06B_V3;

/** The model with this id, or the default when the id is unknown or missing. */
export function speechModelById(id: string | null | undefined): SpeechModelBundle {
  return SPEECH_MODELS.find((m) => m.id === id) ?? DEFAULT_SPEECH_MODEL;
}

/** Where the model is kept. The version is in the folder name, so two builds sit side by side. */
export function modelFolderName(bundle: SpeechModelBundle): string {
  return `${bundle.id}-${bundle.version}`;
}

/** How big the whole model is, in megabytes, for the user. */
export function bundleSizeMb(bundle: SpeechModelBundle): number {
  const bytes = bundle.files.reduce((total, f) => total + f.sizeBytes, 0);
  return Math.round(bytes / (1024 * 1024));
}

/** What we know about one file of a model on this computer. */
export type InstalledFile = {
  name: string;
  /** The file is there. */
  present: boolean;
  /** Its size in bytes, 0 when it is not there. */
  sizeBytes: number;
  /** The build that was checked and found good. */
  verifiedVersion: string | null;
};

export type FileState =
  | 'missing' // not downloaded
  | 'downloading' // on the way
  | 'verifying' // downloaded, being checked
  | 'ready' // checked and good
  | 'corrupt'; // present but not what we published

/**
 * Where one file of a model stands.
 *
 * A file counts as ready only when it has been checked against the checksum we
 * published. That check is remembered, so the app does not re-hash 650 MB on every
 * launch.
 */
export function fileState(
  bundle: SpeechModelBundle,
  file: InstalledFile,
): FileState {
  if (!file.present || file.sizeBytes <= 0) return 'missing';
  const spec = bundle.files.find((f) => f.name === file.name);
  if (!spec) return 'missing';
  if (file.sizeBytes !== spec.sizeBytes) return 'corrupt';
  if (file.verifiedVersion === bundle.version) return 'ready';
  // The right size but never checked: it has to be checked before it is used.
  if (!file.verifiedVersion) return 'verifying';
  return 'verifying';
}

/** Whether every file of the model is checked and good. */
export function bundleReady(
  bundle: SpeechModelBundle,
  files: InstalledFile[],
): boolean {
  return bundle.files.every((f) => {
    const found = files.find((x) => x.name === f.name);
    return found ? fileState(bundle, found) === 'ready' : false;
  });
}

/**
 * Check one file against the model we published.
 *
 * The size is checked first because it is free, and a short download is the common
 * failure. Only then is the whole file hashed.
 */
export function verifySpeechFile(
  bundle: SpeechModelBundle,
  name: string,
  digest: string,
  sizeBytes: number,
): { ok: true } | { ok: false; reason: string } {
  const spec = bundle.files.find((f) => f.name === name);
  if (!spec) return { ok: false, reason: `There is no file called ${name} in this model.` };
  if (sizeBytes !== spec.sizeBytes)
    return {
      ok: false,
      reason: `${name} is ${sizeBytes} bytes but should be ${spec.sizeBytes}. The download did not finish.`,
    };
  if (digest !== spec.sha256)
    return {
      ok: false,
      reason: `${name} is not the file we published, so it was not used.`,
    };
  return { ok: true };
}

/** How far a download has got, as a whole percentage between 0 and 100. */
export function progressPercent(bytesWritten: number, totalBytes: number): number {
  if (!totalBytes || totalBytes <= 0) return 0;
  const pct = Math.round((bytesWritten / totalBytes) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * How far a whole model has got, as a whole percentage.
 *
 * Each file counts for the share of the download it represents, so the number moves
 * evenly instead of jumping when a big file finishes.
 */
export function bundleProgressPercent(
  bundle: SpeechModelBundle,
  bytesWrittenByFile: Record<string, number>,
): number {
  const total = bundle.files.reduce((t, f) => t + f.sizeBytes, 0);
  if (!total) return 0;
  const done = bundle.files.reduce(
    (t, f) => t + Math.min(bytesWrittenByFile[f.name] ?? 0, f.sizeBytes),
    0,
  );
  return progressPercent(done, total);
}

/** What to tell the user about the model. Plain words, no jargon. */
export function modelMessage(
  bundle: SpeechModelBundle,
  files: InstalledFile[],
): { ready: boolean; text: string } {
  const states = bundle.files.map((f) => {
    const found = files.find((x) => x.name === f.name);
    return found ? fileState(bundle, found) : ('missing' as FileState);
  });
  if (states.every((s) => s === 'ready'))
    return { ready: true, text: 'The speech model is installed and checked.' };
  if (states.some((s) => s === 'corrupt'))
    return {
      ready: false,
      text: 'The speech model did not download properly. Download it again.',
    };
  if (states.some((s) => s === 'verifying'))
    return { ready: false, text: 'Checking the speech model…' };
  return {
    ready: false,
    text: `Download the speech model (${bundleSizeMb(bundle)} MB) to transcribe on this computer.`,
  };
}
