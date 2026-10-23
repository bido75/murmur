// Running the speech model on this computer.
//
// The audio never leaves the machine: it is turned into numbers in the renderer, sent to
// this process, and read by the model here.
//
// The model is Parakeet TDT 0.6B v3, quantised to 8-bit. Its three graphs are:
//
//   encoder.onnx  audio_signal FLOAT [batch, 128, frames], length INT64 [batch]
//                 -> outputs FLOAT [batch, 1024, frames], encoded_lengths INT64 [batch]
//   decoder.onnx  targets INT32, target_length INT32, states.1 FLOAT [2, s, 640],
//                 onnx::Slice_3 FLOAT [2, 1, 640]
//                 -> outputs FLOAT [batch, 640, t], prednet_lengths INT32,
//                    states FLOAT [2, s, 640], 162 FLOAT [2, s, 640]
//   joiner.onnx  encoder_outputs FLOAT [batch, 1024, t], decoder_outputs FLOAT [batch, 640, t]
//                 -> outputs FLOAT [batch, vocab, t, 8198]
//
// The engine that runs those graphs is a separate, optional module. Until it is
// installed this refuses in plain words rather than quietly sending the audio to a
// speech service.
import { join } from "node:path";
import { CpuWatcher, resourceStats, type ResourceStats } from "./resources";
import { modelDir } from "./speechModelManager";
import type { SpeechModelBundle } from "../shared/speechModels";
import type { Utterance } from "../shared/transcription/interfaces";

/** What the engine has to be able to do. */
export type LocalRuntime = {
  /**
   * Read one audio file.
   *
   * `samples` is one channel of numbers at the model's rate. The engine returns the
   * words it heard and where they were said.
   */
  transcribe(
    samples: Float32Array,
    options: {
      modelPath: string;
      language: string | null;
      sampleRate: number;
      onProgress?: (percent: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<{
    utterances: { start_ms: number; end_ms: number; text: string }[];
    language: string | null;
  }>;
};

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

/**
 * The engine, loaded the first time it is needed.
 *
 * It is loaded lazily and by name, so the app still starts when the engine is not
 * installed: the user is told what is missing instead of the app failing to open.
 */
let runtime: LocalRuntime | null = null;
let runtimeChecked = false;

function loadRuntime(): LocalRuntime | null {
  if (runtimeChecked) return runtime;
  runtimeChecked = true;
  try {
    // The engine is an optional native module; it is not a dependency of the app yet.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./localRuntime") as { runtime?: LocalRuntime };
    runtime = mod.runtime ?? null;
  } catch {
    runtime = null;
  }
  return runtime;
}

/** Whether the local engine is installed on this computer. */
export function runtimeAvailable(): boolean {
  return loadRuntime() !== null;
}

/** Why the local engine cannot be used, in words the user can act on. */
export function runtimeMissingReason(): string {
  return runtimeAvailable()
    ? ""
    : "Local speech recognition is not installed on this computer. The desktop app sends the recording to the server instead, where it is transcribed.";
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
  const engine = loadRuntime();
  if (!engine) throw new Error(runtimeMissingReason());
  if (!samples.length) throw new Error("There is no audio to transcribe.");

  const watcher = new CpuWatcher();
  const startedAt = Date.now();
  const dir = modelDir(bundle, base);

  const result = await engine.transcribe(samples, {
    modelPath: dir,
    language: options.language ?? null,
    sampleRate: 16000,
    onProgress: (percent) => {
      watcher.sample();
      options.onProgress?.(percent);
    },
    signal: options.signal,
  });

  const tookMs = Date.now() - startedAt;
  const resources = resourceStats();

  return {
    // The engine does not tell speakers apart, so they are all one speaker. It is not
    // made up: the field is a fact about the audio, not a guess.
    utterances: result.utterances.map((u) => ({
      start_ms: Math.max(0, Math.round(u.start_ms)),
      end_ms: Math.max(0, Math.round(u.end_ms)),
      speaker: 0,
      text: u.text,
    })),
    durationMs: Math.max(
      0,
      ...result.utterances.map((u) => Math.round(u.end_ms)),
    ),
    language: result.language,
    resources,
    tookMs,
  };
}

/** Where the model files are, for the engine to find them. */
export function modelPathFor(
  bundle: SpeechModelBundle,
  base: string,
): string {
  return join(modelDir(bundle, base), "encoder.onnx");
}
