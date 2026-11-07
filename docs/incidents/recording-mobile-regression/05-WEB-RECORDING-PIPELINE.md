# Web recording pipeline verification

The pipeline steps below were verified as intact and unchanged by this incident:

| Step | Status | Evidence |
|---|---|---|
| Tap Start → consent | unchanged | `src/lib` recording flow untouched by all suspect commits |
| Permission request | was blocked by header, now allowed | `microphone=(self)` live |
| Stream → MediaRecorder → chunks | unchanged code; unit tests green | `src/lib/recorder.ts` / mic tests |
| Local recovery metadata | unchanged | recovery modules + tests |
| Supabase upload / recording row | backend verified independently | Deno 192/0; live API 200s (2026-10-29 checks) |
| Transcription + notes | unchanged | server-side; process-recording contract stable |

Key point: **only step 2 was broken**, by a server header — the pipeline itself never
regressed. Backend upload/processing was verified working during the release-verification
sprint and re-confirmed by the Deno suite today; a fixture-upload click test remains
available to the operator once recording works on device.
