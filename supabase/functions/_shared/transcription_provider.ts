// The provider-independent transcription interface.
//
// Every engine the app can use — Deepgram in the cloud, whisper on the phone, Parakeet
// on the desktop — produces the same result, so nothing else in the app has to know
// which one ran. This lives in the shared folder because the phone, the server and the
// desktop app all speak it.
//
// Nothing is invented. A field the engine cannot supply (a speaker label, a confidence
// score) is absent rather than guessed at.

import type { Utterance } from './verify.ts';

export type ProviderType = 'deepgram' | 'whisper' | 'parakeet';

export type TranscriptionResult = {
  utterances: Utterance[];
  durationMs: number;
  language: string | null;
  provider: ProviderType;
  /** Only when the engine actually reports one. */
  confidence?: number;
};

export type TranscriptionOptions = {
  /** The language to use, or null to let the engine work it out. */
  language?: string | null;
  /** Where in the recording this part starts, so the times line up. */
  offsetMs?: number;
  /** 'local-only' means nothing may leave the device. */
  privacy?: 'local-only' | 'cloud-allowed';
  /** Details to take out of the text, when the provider supports it. */
  redact?: string[];
  /** The recording has two channels and they are different people. */
  multichannel?: boolean;
  /** Words the provider should look for. */
  keyterms?: string[];
  /** How far the job has got, as a whole percentage. */
  onProgress?: (percent: number) => void;
  /** Stops the job when it is aborted. */
  signal?: AbortSignal;
};

/**
 * Where the audio is.
 *
 * A local engine reads the audio itself, so it is given the samples. An engine that
 * needs a file on disk is given the path. A cloud engine has to fetch the audio, so it
 * is given a URL it can download.
 */
export type AudioSource =
  | { kind: 'samples'; samples: Float32Array; sampleRate: number }
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string };

export interface TranscriptionProvider {
  readonly type: ProviderType;

  /** Whether this engine can run at all on this machine. */
  isAvailable(): Promise<boolean>;

  /**
   * Whether this engine may be used for this job.
   *
   * A cloud provider refuses when the user asked for local-only privacy, so the rule is
   * enforced here as well as in the choice of engine.
   */
  canTranscribe(options?: TranscriptionOptions): boolean;

  /**
   * Transcribe one part.
   */
  transcribe(
    source: AudioSource,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}
