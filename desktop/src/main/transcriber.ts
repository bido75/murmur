// Running the speech model on this computer.
//
// The audio never leaves the machine: it is turned into numbers in the renderer, sent to
// this process, and read by the model here.
//
// The model is Parakeet TDT 0.6B v3, quantised to 8-bit. Its graphs are:
//
//   nemo128.onnx              the mel front end: audio -> 128 features per frame
//   encoder-model.int8.onnx   the acoustic encoder: features -> 1024 numbers per frame
//   decoder_joint-model.int8.onnx  the prediction network and the joint
//
// The engine is loaded once and kept, because loading it takes a few seconds. The
// ONNX runtime is loaded lazily, so the app still starts when it is missing: the user
// is told what is missing instead of the app failing to open.
import { CpuWatcher, resourceStats, type ResourceStats } from "./resources.ts";
import { modelDir } from "./speechModelManager.ts";
import { ParakeetEngine } from "./parakeet/engine.ts";
import { MODEL_SAMPLE_RATE } from "../shared/parakeet.ts";
import type { SpeechModelBundle } from "../shared/speechModels.ts";
import type { Utterance } from "../shared/transcription/interfaces.ts";

export type TranscribeOptions = {
  language?: string | null;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
};

export type TranscribeResult = {
  utterances: Utterance[];
  durationMs: number;
  language: string | null;
  /** How the job went, for the log and for the user. */
  resources: ResourceStats;
  /** How long it took, in milliseconds. */
  tookMs: number;
};

/** The loaded engine, so it is loaded once and kept. */
let engine: ParakeetEngine | null = null;
let engineDir: string | null = null;
let enginePromise: Promise<ParakeetEngine> | null = null;

/** Forget the engine, so the next job loads it again. */
export function forgetEngine(): void {
  void engine?.close();
  engine = null;
  engineDir = null;
  enginePromise = null;
}

/** The engine, loaded if it is not already. */
async function getEngine(modelPath: string): Promise<ParakeetEngine> {
  if (engine && engineDir === modelPath) return engine;
  if (engine && engineDir !== modelPath) {
    await engine.close();
    engine = null;
  }
  if (!enginePromise)
    enginePromise = ParakeetEngine.create(modelPath).then((e) => {
      engine = e;
      engineDir = modelPath;
      enginePromise = null;
      return e;
    });
  return enginePromise;
}

/** Whether the local engine is installed on this computer. */
export async function runtimeAvailable(modelPath: string): Promise<boolean> {
  try {
    const e = await getEngine(modelPath);
    return e !== null;
  } catch {
    return false;
  }
}

/** Why the local engine cannot be used, in words the user can act on. */
export function runtimeMissingReason(): string {
  return "Local speech recognition is not installed on this computer. The desktop app sends the recording to the server instead, where it is transcribed.";
}

/**
 * Transcribe one part on this computer.
 *
 * The audio is one channel of numbers at the model's rate; nothing is read from the
 * network and nothing is written to disk.
 */
export async function transcribeSamples(
  bundle: SpeechModelBundle,
  base: string,
  samples: Float32Array,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  if (!samples.length) throw new Error("There is no audio to transcribe.");

  const watcher = new CpuWatcher();
  const startedAt = Date.now();
  const dir = modelDir(bundle, base);

  let local;
  try {
    local = await getEngine(dir);
  } catch (e) {
    throw new Error(
      `${runtimeMissingReason()} (${(e as Error).message})`,
    );
  }

  const result = await local.transcribe(samples, {
    onProgress: (percent) => {
      watcher.sample();
      options.onProgress?.(percent);
    },
    signal: options.signal,
  });

  const tookMs = Date.now() - startedAt;
  const resources = resourceStats();

  return {
    // The engine does not tell speakers apart, so they are all one speaker. That is a
    // fact about the audio, not a guess.
    utterances: result.utterances.map((u) => ({
      start_ms: Math.max(0, Math.round(u.start_ms)),
      end_ms: Math.max(0, Math.round(u.end_ms)),
      speaker: 0,
      text: u.text,
    })),
    durationMs: Math.max(0, ...result.utterances.map((u) => u.end_ms)),
    language: result.language,
    resources,
    tookMs,
  };
}

/** The rate the model is fed at. */
export { MODEL_SAMPLE_RATE };
