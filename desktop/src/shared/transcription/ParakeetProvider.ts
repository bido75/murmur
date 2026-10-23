// The desktop adapter for local speech recognition.
//
// The audio is transcribed by the main process, on this computer. Nothing is sent to a
// speech service and the recording never leaves the machine.
//
// The engine is Parakeet, run through ONNX Runtime. The model weights (NVIDIA's Parakeet
// TDT 0.6B v3, and the int8 ONNX export) are published under CC BY 4.0, so they can be
// used freely with attribution. No AGPL-licensed code is used here: the reference
// project this is modelled on is AGPL-3.0, and none of its source was copied.
//
// The runtime is a separate, optional download. Until it is installed the main process
// refuses, and this adapter says so plainly rather than falling back to the cloud.
import type {
  ProviderType,
  TranscriptionOptions,
  TranscriptionResult,
} from "./interfaces";

export class ParakeetProvider {
  readonly type = "parakeet";

  /** Whether the local speech runtime is present on this computer. */
  async isAvailable(): Promise<boolean> {
    if (!window.murmur) return false;
    try {
      await window.murmur.transcribeLocal("", { language: null });
      return true;
    } catch {
      // The runtime refuses when it is not installed.
      return false;
    }
  }

  /**
   * Transcribe an audio file on this computer.
   *
   * There is no cloud fallback: the desktop app already sends its recordings to the
   * server for cloud transcription, and a local request must never do that behind the
   * user's back.
   */
  async transcribe(
    path: string,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    const bridge = window.murmur;
    if (!bridge)
      throw new Error(
        "Local speech recognition is not available in this window.",
      );

    const result = await bridge.transcribeLocal(path, {
      language: options?.language ?? null,
    });

    return {
      utterances: result.utterances,
      durationMs: result.durationMs,
      language: result.language ?? options?.language ?? null,
      provider: "parakeet",
    };
  }
}
