// On-device transcription with whisper.cpp (whisper.rn). The audio never leaves the phone; only
// the text is sent for notes. Needs a development or production build (not Expo Go).
// iOS records the 16 kHz PCM WAV whisper.rn reads directly; Android goes through pcmRecorder.ts.
//
// The model itself is installed and checked by transcription/modelManager.ts, so a
// download that was cut short is never used.
import { Platform } from "react-native";
import { pcmRecorderAvailable } from "./pcmRecorder";
import { whisperToUtterances } from "./shared";
import {
  DEFAULT_MODEL,
  installModel,
  installedModelFile,
  modelFile,
  removeModel,
  verifyInstalledModel,
  type InstallProgress,
} from "./transcription/modelManager";
import type { Utterance } from "./types";

export const MODEL_MB = DEFAULT_MODEL.sizeMb;

/** The model, with who made it and under what licence. Shown to the user. */
export const MODEL_ATTRIBUTION = `${DEFAULT_MODEL.label}. ${DEFAULT_MODEL.attribution}`;

// The few whisper.rn calls we use (typed here so the app doesn't type-check the library's source).
type Ctx = {
  transcribe(
    path: string,
    opts: { language?: string; maxLen?: number },
  ): {
    stop(): Promise<void>;
    promise: Promise<{
      isAborted: boolean;
      segments: { text: string; t0: number; t1: number }[];
    }>;
  };
};
type WhisperModule = { initWhisper(o: { filePath: string }): Promise<Ctx> };
let mod: WhisperModule | null | undefined;
let ctx: Ctx | null = null;

function whisper(): WhisperModule | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("whisper.rn/index") as WhisperModule;
  } catch {
    mod = null; // Expo Go or a build without the native module
  }
  return mod;
}

export function localSttSupported(): boolean {
  return (
    whisper() !== null && (Platform.OS === "ios" || pcmRecorderAvailable())
  );
}

/**
 * Whether the model is on the device and the right size.
 *
 * A model downloaded before versions were added is still accepted, so nobody has to
 * fetch 60 MB again. The full check (the checksum) is done when the model is installed
 * and is remembered, so this stays cheap enough to call while the screen is opening.
 */
export function modelReady(): boolean {
  const file = installedModelFile(DEFAULT_MODEL);
  return file.exists && file.size === DEFAULT_MODEL.sizeBytes;
}

/**
 * Download the speech model and check it.
 *
 * The progress is reported and the download can be stopped. A download that fails or is
 * stopped leaves nothing behind that could be mistaken for a good model.
 */
export async function downloadModel(
  onProgress?: (p: InstallProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const result = await installModel(DEFAULT_MODEL, { onProgress, signal });
  if (!result.ok) throw new Error(result.reason);
}

/** Remove the model and the note that says it was checked. */
export async function deleteModel() {
  await removeModel(DEFAULT_MODEL);
  ctx = null;
}

/** Get the model file path for use by adapters. */
export function getModelPath(): string {
  return modelFile().uri;
}

/** Recording options for a file whisper can read (applied when each part starts). */
export const LOCAL_RECORDING = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  ios: {
    extension: ".wav",
    outputFormat: "lpcm",
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
    audioQuality: 96,
  },
} as const;

export async function transcribeLocal(
  uri: string,
  offsetMs: number,
  language: string | null,
  signal?: AbortSignal,
): Promise<Utterance[]> {
  const w = whisper();
  if (!w)
    throw new Error("On-device transcription isn’t available in this build.");
  if (!modelReady())
    throw new Error("Download the speech model in Settings → Privacy & data.");
  // The model is checked before it is used; a file that fails the check is refused.
  if (!(await verifyInstalledModel()))
    throw new Error(
      "The speech model on this device did not pass its check. Download it again.",
    );
  ctx ??= await w.initWhisper({ filePath: modelFile().uri });
  const handle = ctx.transcribe(uri, {
    language: language && language !== "multi" ? language : "auto",
    maxLen: 0,
  });
  // Stopping the job when it is aborted: whisper is told to stop, and the result comes
  // back marked as interrupted.
  const onAbort = () => {
    void handle.stop().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await handle.promise;
    if (res.isAborted) throw new Error("Transcription was interrupted.");
    return whisperToUtterances(res.segments, offsetMs);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
