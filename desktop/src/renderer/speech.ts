// Transcribing on this computer, in the renderer.
//
// The renderer decodes the recorded audio with the browser's own audio tools, so no
// decoder has to be added. It then asks the main process to read it with the speech
// model. Nothing is sent anywhere.
//
// The recording has two channels: this computer's microphone on the left, the call on
// the right. The model cannot tell speakers apart, but it can read each channel on its
// own, so the words of the person recording become speaker 0 and the words of the call
// become speaker 1. That matches what the server does with a two-channel recording.
import type { Bridge, SpeechModelProgress, SpeechModelStatus } from "../shared/bridge";
import { MODEL_SAMPLE_RATE, toModelSamples } from "../shared/pcm";

declare const window: Window & { murmur: Bridge };
const bridge = () => window.murmur;

export type LocalUtterance = {
  start_ms: number;
  end_ms: number;
  speaker: number;
  text: string;
};

export type SpeechState = {
  status: SpeechModelStatus | null;
  progress: SpeechModelProgress | null;
  installing: boolean;
  error: string | null;
  /** Whether recordings are made on this computer. */
  local: boolean;
};

export const speech: SpeechState = {
  status: null,
  progress: null,
  installing: false,
  error: null,
  local: false,
};

/** Remembered so a restart does not lose the choice. */
const LOCAL_KEY = "murmur.speech.local";

export function loadSpeechPreference(): boolean {
  try {
    return localStorage.getItem(LOCAL_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSpeechPreference(local: boolean): void {
  try {
    localStorage.setItem(LOCAL_KEY, local ? "1" : "0");
  } catch {
    // Without storage the choice lasts only for this run, which is not fatal.
  }
}

/** Ask the main process what state the model is in. */
export async function loadSpeechStatus(): Promise<SpeechModelStatus | null> {
  try {
    speech.status = await bridge().speechModel();
  } catch (e) {
    speech.error = (e as Error).message;
  }
  return speech.status;
}

/** Start the download. Progress arrives on the "speech:progress" channel. */
export async function installSpeechModel(): Promise<void> {
  speech.installing = true;
  speech.error = null;
  speech.progress = { percent: 0, file: "", stage: "downloading" };
  try {
    const result = await bridge().speechModelInstall();
    if (!result.ok) speech.error = result.reason;
  } catch (e) {
    speech.error = (e as Error).message;
  } finally {
    speech.installing = false;
    await loadSpeechStatus();
  }
}

/** Stop a download that is running. */
export async function cancelSpeechModel(): Promise<void> {
  await bridge().speechModelCancel();
  speech.installing = false;
}

/** Remove the model from this computer. */
export async function removeSpeechModel(): Promise<void> {
  await bridge().speechModelRemove();
  await loadSpeechStatus();
}

/** Listen for the download's progress. */
export function onSpeechProgress(fn: (p: SpeechModelProgress) => void): () => void {
  return bridge().on("speech:progress", (payload) => {
    const p = payload as SpeechModelProgress;
    speech.progress = p;
    fn(p);
  });
}

/**
 * Read one recorded part with the speech model.
 *
 * The part is decoded here, one channel at a time, and each channel is transcribed on
 * its own. The words are returned on the recording's own timeline.
 */
export async function transcribeSegment(
  path: string,
  offsetMs: number,
  language: string | null,
): Promise<LocalUtterance[]> {
  const bytes = await bridge().fileRead(path);
  if (!bytes.length) return [];

  const ctx = new AudioContext();
  let buffer: AudioBuffer;
  try {
    // decodeAudioData needs its own copy of the bytes.
    buffer = await ctx.decodeAudioData(bytes.slice().buffer);
  } catch (e) {
    throw new Error(
      `This browser could not read the recording (${(e as Error).message}). The recording was not sent anywhere; it is still on this computer.`,
    );
  } finally {
    void ctx.close();
  }

  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++)
    channels.push(buffer.getChannelData(c));

  const utterances: LocalUtterance[] = [];
  for (const [index, channel] of channels.entries()) {
    const samples = toModelSamples([channel], buffer.sampleRate);
    if (!samples.length) continue;
    const result = await bridge().transcribeLocal(samples, { language });
    for (const u of result.utterances) {
      utterances.push({
        start_ms: offsetMs + u.start_ms,
        end_ms: offsetMs + u.end_ms,
        // Channel 0 is the person recording; channel 1 is the call.
        speaker: index,
        text: u.text,
      });
    }
  }

  // In time order, so the transcript reads properly.
  utterances.sort((a, b) => a.start_ms - b.start_ms || a.speaker - b.speaker);
  return utterances;
}

/** Whether the recording can be made on this computer. */
export function canTranscribeLocally(): boolean {
  return Boolean(speech.status?.ready && speech.status?.engineAvailable);
}

/** The rate the model is fed at. */
export const sampleRate = MODEL_SAMPLE_RATE;
