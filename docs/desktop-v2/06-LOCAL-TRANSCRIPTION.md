# Local transcription (Desktop V2, Phase 3)

Status as of 2026-10-29. Every claim below traces to code listed in "Where".

## Architecture

- **One provider interface, three apps.** `TranscriptionProvider` is defined once in
  `supabase/functions/_shared/transcription_provider.ts` and re-exported by the desktop
  (`desktop/src/shared/transcription/interfaces.ts`). The server (Deepgram), the phone
  (Whisper) and the desktop (Parakeet) speak the same shape. No desktop-only duplicate
  interface exists.
- **The desktop engine is Parakeet** (NVIDIA Parakeet TDT 0.6B v3, int8 ONNX export) run
  through `onnxruntime-node` in the **main process** (`src/main/transcriber.ts`,
  `src/main/parakeet/engine.ts`). The renderer decodes WebM/Opus with the browser's
  `decodeAudioData`, converts to model sample rate (`src/shared/pcm.ts`), and sends
  samples over IPC; nothing leaves the machine.
- **Speaker labels** come from the stereo layout (mic = channel 0/speaker 0, call =
  channel 1/speaker 1), matching the server's two-channel handling. Parakeet does not
  diarize beyond this; no confidence values are invented (the shared interface omits
  what the engine cannot supply).
- **No silent cloud fallback.** `ParakeetProvider.canTranscribe()` is always true and its
  `transcribe()` contacts nothing; when the runtime is missing the adapter refuses in
  plain words instead of falling back.

## Local Only enforcement (tested, not just UI)

- The shared options type carries `privacy: "local-only" | "cloud-allowed"`.
- `desktop/src/shared/transcription/select.ts` `pickProvider()` enforces the mode at
  selection: a cloud provider (`deepgram`) is refused with a typed
  `local-only-refused` result even if it is the only provider present, and even if a
  buggy cloud provider claims it can transcribe. Seven unit tests cover these paths,
  including "an unavailable local engine must not become a cloud fallback".
- Recording-type scope: `localOnly` in the settings store is device-local on purpose;
  the renderer's speech preference (`speech.local`) gates whether new recordings are
  transcribed on-device.

## Model files and runtime

- Files expected under `userData/speech/<model>`: `nemo128.onnx`,
  `encoder-model.int8.onnx`, `decoder_joint-model.int8.onnx`, `vocab.txt`.
- Source: `https://github.com/Kieirra/murmure-model/releases/download/1.3.0/parakeet-tdt-0.6b-v3-int8.zip`
  (HTTPS, versioned release). Weights are CC BY 4.0 **with attribution shipped in the
  app** (`speechModels.ts`). No AGPL source from the reference project is used.
- Install verification: archive SHA-256 **and** per-file SHA-256 digests are checked
  before a file is accepted (`speechModelManager.ts:236,304`); a version marker prevents
  re-downloading a matching version. Downloads are explicit user actions with progress,
  cancellation, and no automatic multi-hundred-MB fetch.

## Honest limits

- **Runtime soak on real audio is NOT TESTED in this environment** (no microphone or
  meeting audio hardware). The ONNX engine integration test exists
  (`src/main/parakeet/engine.integration.test.ts`, skipped without the model).
- Long-audio chunking beyond the existing 5-minute segment rotation is unchanged from
  the baseline; Whisper (local runtime) is not present in the desktop build — the
  provider interface accepts a future `whisper` provider without changes.
- Cloud transcription through `process-recording` continues to work exactly as before;
  it is never triggered for local-only recordings because those recordings are never
  uploaded.
