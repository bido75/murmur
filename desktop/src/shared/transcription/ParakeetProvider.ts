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
import type { Bridge } from "../bridge";
import type {
  AudioSource,
  ProviderType,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "./interfaces";

declare const window: Window & { murmur: Bridge };

export class ParakeetProvider implements TranscriptionProvider {
  readonly type: ProviderType = "parakeet";

  /** Whether the local speech runtime is present on this computer. */
  async isAvailable(): Promise<boolean> {
    if (!window.murmur) return false;
    try {
      await window.murmur.transcribeLocal(new Float32Array(0), {
        language: null,
      });
      return true;
    } catch {
      // The runtime refuses when it is not installed.
      return false;
    }
  }

  /**
   * Parakeet is local, so it is always allowed.
   *
   * There is no cloud fallback in this adapter: the desktop app already sends its
   * recordings to the server for cloud transcription, and a local request must never
   * do that behind the user's back.
   */
  canTranscribe(): boolean {
    return true;
  }

  /**
   * Transcribe audio on this computer.
   *
   * The audio is given as samples: one channel of numbers at the model's rate. Nothing
   * is sent anywhere — no speech service is contacted and no file is written.
   */
  async transcribe(
    source: AudioSource,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    if (source.kind !== "samples")
      throw new Error(
        "This engine reads the audio itself, so it needs the samples rather than a link or a path.",
      );

    const bridge = window.murmur;
    if (!bridge)
      throw new Error("Local speech recognition is not available in this window.");

    const result = await bridge.transcribeLocal(source.samples, {
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
