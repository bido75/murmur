// Client-side Whisper adapter — wraps whisper.rn via localStt.
// Runs on the device; audio never leaves the phone.
import { getModelPath, modelReady, localSttSupported } from "@/lib/localStt";
import { whisperToUtterances } from "@/lib/shared";
import type { Utterance } from "@/lib/types";

export type ProviderType = "deepgram" | "whisper" | "parakeet";

export interface TranscriptionResult {
  utterances: Utterance[];
  durationMs: number;
  language: string | null;
  provider: ProviderType;
  confidence?: number;
}

export interface TranscriptionOptions {
  language?: string | null;
  redact?: string[];
  multichannel?: boolean;
  keyterms?: string[];
  privacy?: "local-only" | "cloud-allowed";
  offsetMs?: number;
}

export class WhisperProvider {
  readonly type = "whisper";

  async canTranscribe(): Promise<boolean> {
    return localSttSupported() && modelReady();
  }

  async transcribe(
    uri: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult> {
    const w = whisperModule();
    if (!w) throw new Error("On-device transcription isn't available in this build.");
    if (!modelReady()) throw new Error("Download the speech model in Settings → Privacy & data.");

    const mod = await w.initWhisper({ filePath: getModelPath() });
    const { promise } = mod.transcribe(uri, {
      language: options?.language && options.language !== "multi" ? options.language : "auto",
      maxLen: 0,
    });
    const res = await promise;
    if (res.isAborted) throw new Error("Transcription was interrupted.");

    const utterances = whisperToUtterances(res.segments, options?.offsetMs ?? 0);

    const durationMs = res.segments.reduce(
      (total: number, seg: { t0: number; t1: number }) => total + (seg.t1 - seg.t0),
      0,
    );

    return {
      utterances,
      durationMs,
      language: options?.language ?? null,
      provider: "whisper",
    };
  }
}

function whisperModule() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("whisper.rn/index");
    return mod;
  } catch {
    return null;
  }
}