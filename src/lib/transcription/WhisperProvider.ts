// The Whisper adapter for the phone.
//
// It does not run the model itself: `localStt.ts` already does that, and this only
// puts the result in the shape the rest of the app expects. The audio never leaves the
// device — only the words are sent, so the notes can be written.
import { localSttSupported, modelReady, transcribeLocal } from "@/lib/localStt";
import type {
  ProviderType,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "@/lib/shared";

export class WhisperProvider implements TranscriptionProvider {
  readonly type: ProviderType = "whisper";

  async isAvailable(): Promise<boolean> {
    return localSttSupported() && modelReady();
  }

  /**
   * Whisper is local, so it is always allowed. The rule that stops an upload is applied
   * to the cloud provider; refusing here as well would stop the app from transcribing
   * on the device, which is the safe thing to do.
   */
  canTranscribe(): boolean {
    return true;
  }

  async transcribe(
    uri: string,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    if (!localSttSupported())
      throw new Error("On-device transcription isn’t available in this build.");
    if (!modelReady())
      throw new Error(
        "Download the speech model in Settings → Privacy & data.",
      );

    const utterances = await transcribeLocal(
      uri,
      options?.offsetMs ?? 0,
      options?.language ?? null,
      options?.signal,
    );

    return {
      utterances,
      // The times of the words are the length of the recording, as near as it goes.
      durationMs: utterances.reduce(
        (total, u) => total + (u.end_ms - u.start_ms),
        0,
      ),
      language: options?.language ?? null,
      provider: "whisper",
    };
  }
}
