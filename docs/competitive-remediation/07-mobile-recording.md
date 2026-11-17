# P0 — Mobile microphone warning & slowness: root cause

## Confirmed defect (fixed)

The "Not hearing anything yet" warning was keyed off **audio volume** (`metering < -55 dBFS` for 60 s), not capture health. A quiet room — or quiet speech, or noise suppression dipping the meter — reads below -55 dBFS and triggers a false "mic failure" warning. That is not a dead microphone; it is normal low volume.

The recorder already has the correct signal for a real failure: the **stalled-recorder check** (`durationMillis` not advancing for >4 s → "Recording stopped by the system … Tap Restart mic"). The volume-based warning was redundant with that *and* wrong.

**Fix (`src/lib/recorder.ts`):** removed the volume-based silence warning; kept the stalled-recorder (capture-health) warning. Removed the now-unused `SILENCE_DB` / `SILENCE_WARN_MS` (`src/lib/config.ts`).

This also explains the "2 parts saved at 7:24" observation: the false warning prompted "Restart mic" (`restartMic` = `rotate`), which finalizes the current segment early — hence an extra saved part (and a needless rotation gap). With the false warning gone, the user is no longer prompted to restart unnecessarily.

## Secondary fix: metering re-render churn

`setPcmLevel` was called with a raw float every 500 ms (the PCM/on-device path), forcing a record-screen re-render each tick. It now rounds to a whole dB and skips no-op updates, so the meter only re-renders when the level actually changes.

## Hypotheses still to verify (need the device)

1. **Genuine audio loss vs quiet room** — must be confirmed by playing back the saved 7:24 recording around the warning moment. If the audio is clear speech, it was a false alarm (now fixed). If it goes silent at a segment boundary, there is a separate capture bug to chase.
2. **Overall slowness** — the metering churn was one contributor, but the reported slow navigation needs real Android profiling (startup, render frequency, JS stalls, request volume). No before/after performance claim is made here.

## Next steps (operator-owned)

- Play back the existing recording and inspect the audio around the warning (confirm speech is present).
- Run the Phase 7 device matrix (continuous speech, quiet, 30 min, Bluetooth switch, restart-mic, etc.).
- Profile startup/navigation on the NX789J against an earlier build.
