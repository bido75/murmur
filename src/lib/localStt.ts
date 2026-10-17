// On-device transcription with whisper.cpp (whisper.rn). The audio never leaves the phone; only
// the text is sent for notes. Needs a development/production build (not Expo Go) and, for now,
// iOS: whisper.rn reads 16 kHz PCM WAV, which iOS can record directly. Untested on hardware.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { whisperToUtterances } from './shared';
import type { Utterance } from './types';

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin';
export const MODEL_MB = 57;

// The few whisper.rn calls we use (typed here so the app doesn't type-check the library's source).
type Ctx = {
  transcribe(path: string, opts: { language?: string; maxLen?: number }): { stop(): Promise<void>; promise: Promise<{ isAborted: boolean; segments: { text: string; t0: number; t1: number }[] }> };
};
type WhisperModule = { initWhisper(o: { filePath: string }): Promise<Ctx> };
let mod: WhisperModule | null | undefined;
let ctx: Ctx | null = null;

function whisper(): WhisperModule | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('whisper.rn/index') as WhisperModule;
  } catch {
    mod = null; // Expo Go or a build without the native module
  }
  return mod;
}

export function localSttSupported(): boolean {
  return Platform.OS === 'ios' && whisper() !== null;
}

function modelFile(): File {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, 'ggml-base-q5_1.bin');
}

export function modelReady(): boolean {
  const f = modelFile();
  return f.exists && f.size > 40 * 1024 * 1024;
}

export async function downloadModel(): Promise<void> {
  const f = modelFile();
  if (f.exists) f.delete();
  await File.downloadFileAsync(MODEL_URL, f);
  if (!modelReady()) throw new Error('The speech model didn’t download completely. Try again on Wi-Fi.');
}

export function deleteModel() {
  const f = modelFile();
  if (f.exists) f.delete();
  ctx = null;
}

/** Recording options for a file whisper can read (applied when each part starts). */
export const LOCAL_RECORDING = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  ios: { extension: '.wav', outputFormat: 'lpcm', sampleRate: 16000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false, audioQuality: 96 },
} as const;

export async function transcribeLocal(uri: string, offsetMs: number, language: string | null): Promise<Utterance[]> {
  const w = whisper();
  if (!w) throw new Error('On-device transcription isn’t available in this build.');
  if (!modelReady()) throw new Error('Download the speech model in Settings → Privacy & data.');
  ctx ??= await w.initWhisper({ filePath: modelFile().uri });
  const { promise } = ctx.transcribe(uri, { language: language && language !== 'multi' ? language : 'auto', maxLen: 0 });
  const res = await promise;
  if (res.isAborted) throw new Error('Transcription was interrupted.');
  return whisperToUtterances(res.segments, offsetMs);
}
