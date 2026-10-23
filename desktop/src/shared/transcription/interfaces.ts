// The provider-independent transcription interface.
//
// Every engine the app can use produces the same shape, so the rest of the app does not
// care which one ran. Nothing is invented: a field the engine cannot supply is absent
// rather than guessed at.
import type { Bridge } from "../bridge";

export type ProviderType = "deepgram" | "whisper" | "parakeet";

/** One spoken piece, on the recording's own timeline. */
export type Utterance = {
  start_ms: number;
  end_ms: number;
  /** Which speaker. 0 when the engine cannot tell speakers apart. */
  speaker: number;
  text: string;
};

export type TranscriptionResult = {
  utterances: Utterance[];
  durationMs: number;
  language: string | null;
  provider: ProviderType;
  /** Only when the engine actually reports one. */
  confidence?: number;
};

export type TranscriptionOptions = {
  language?: string | null;
};

export interface TranscriptionProvider {
  readonly type: ProviderType;
  /** Whether the engine can run right now. */
  isAvailable(): Promise<boolean>;
  transcribe(
    source: string,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}

/** The bridge the preload script exposes. */
declare global {
  interface Window {
    murmur?: Bridge;
  }
}
