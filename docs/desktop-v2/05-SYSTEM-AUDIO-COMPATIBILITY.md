# System audio compatibility (Desktop V2, Phase 3)

Status as of 2026-10-29, traced to `desktop/src/renderer/capture.ts`,
`desktop/src/main/main.ts`, `desktop/native/macos/SystemAudioCapture.swift`.

## Capability matrix

| Capability | Windows 10/11 (x64) | macOS 13+ (arm64/Intel) | Linux |
|---|---|---|---|
| Microphone capture | IMPLEMENTED (getUserMedia via Chromium) | IMPLEMENTED (same, plus TCC prompt via `systemPreferences.askForMediaAccess`) | UNTESTED in this environment; Chromium supports it but no Linux hardware was available |
| System audio (loopback) | IMPLEMENTED BUT NOT LIVE-TESTED — `getDisplayMedia` with `audio: "loopback"` answered by the main process `setDisplayMediaRequestHandler` (screen source + Windows loopback audio; the video track is dropped, audio is routed to channel 1) | IMPLEMENTED BUT NOT LIVE-TESTED — ScreenCaptureKit helper binary (`SystemAudioCapture`) streams float32 48 kHz mono over stdout; requires Screen & System Audio Recording permission (TCC); denial degrades to mic-only with an explicit message | UNSUPPORTED — no PipeWire/PulseAudio monitor path is implemented; the UI does not offer it |
| Mic + system in one recording (stereo) | Same as loopback row | Same as loopback row | UNSUPPORTED |
| Device selection (input picker) | PARTIAL — default device only; explicit device enumeration is Phase 4 work | PARTIAL — same | UNSUPPORTED |
| Screen recording (video kept) | IMPLEMENTED BUT NOT LIVE-TESTED | IMPLEMENTED BUT NOT LIVE-TESTED | UNSUPPORTED |
| Device disconnect mid-recording | PARTIAL — track `ended` warns ("Screen sharing stopped. Still recording audio."); mic dropout covered by the silence warning after 15 s quiet | same | UNSUPPORTED |

## Behavior guarantees (from code)

- **Never silently record system audio**: loopback only starts after the user picks a
  screen/source in the OS picker, and the active state is reflected in
  `systemAudio: "on" | "unavailable" | "denied"` with warnings on failure
  (`capture.ts:174-179`).
- **Never bypass OS permissions**: the macOS helper relies on the OS TCC prompt; the
  main process's permission handler allows `media`/`display-capture` only for the app's
  own `file://` pages (`main.ts`).
- **Failure is explicit**: capture failure or permission denial degrades to mic-only
  with a visible warning; it never fakes a system-audio track.
- **Synchronization/drift**: mic and system audio are mixed on one WebM timeline by the
  Web Audio graph (shared `AudioContext`, 48 kHz), not concatenated streams. A
  long-recording drift measurement has NOT been performed (needs real hardware); this
  is recorded as a gap, not as a pass.
- **Crash safety**: audio is appended to disk every `CHUNK_MS` and rotated every
  `SEGMENT_MS` (5 min); at most a few seconds are lost to a crash (`capture.ts` header
  contract; segment files are named by the main process only).

## What would be needed to claim more

- A Windows VM/box with audio endpoints to verify loopback end-to-end and measure drift
  over a 60-minute recording.
- A Mac with mic + any playing audio to verify the ScreenCaptureKit helper and TCC flow.
- Linux work is out of scope until the operator asks for a Linux distribution.
