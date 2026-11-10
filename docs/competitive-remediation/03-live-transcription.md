# Phase 3 — Live Transcription & Speaker Recognition

Status: **audited; small, testable hardening done. Streaming/diarization reliability remains unverified (needs live provider).**

## 6.1 Existing implementation (audited)

- `supabase/functions/live/index.ts` — `POST /token` issues a short-lived Deepgram token + `wss://…/listen` URL with `liveParams`.
- `desktop/src/renderer/live.ts` — `startLive(stream, onLines, onError)` streams mixed mic+system audio to Deepgram over WebSocket (MediaRecorder 250 ms chunks); display-only (the saved transcript still comes from the pipeline).
- `_shared/stt.ts` — `deepgramParams` (pipeline: diarize, multichannel, keyterms) and `liveParams` (stream: interim_results).
- Speaker rename/utterance edit: `api.ts` `setSpeakerName`, `updateUtteranceText`; dictionary in `desktop/src/shared/dictionary.ts`.

## This phase's changes

- `mergeLive` extracted to `desktop/src/shared/liveMerge.ts` (pure) + 4 tests (provisional→final replacement, accumulation, empty no-op, window cap).
- `liveParams` now accepts and appends `keyterms` (nova-3 vocabulary hints) — pure + tested (`stt.test.ts`).

## Gap matrix (6.2–6.7)

| Capability | Status |
|---|---|
| Streaming audio + provisional/final | ✅ present (`mergeLive`) |
| Stable utterance IDs | ❌ live lines have no IDs (display-only; saved transcript owns IDs) |
| Reconnection | ❌ on drop, only shows "disconnected" |
| Backpressure / duplicate prevention | ⚠️ `mergeLive` dedups; no explicit backpressure |
| Timestamps on live lines | ❌ none |
| Speaker diarization in live | ❌ `liveParams` does not set `diarize`; `live.ts` reads a single alternative |
| Speaker rename/edit | ✅ existing (saved transcript) |
| Custom vocabulary → live | ⚠️ `liveParams` supports `keyterms` now, but `/token` does not yet fetch/pass them (needs recording context) |
| Live summary / bookmarks | ❌ not in the live path |

## Remaining (explicit)

1. Wire `keyterms` into `/token` (accept `recording_id`, fetch project vocabulary + speaker names) — 6.4.
2. `diarize` + speaker parsing in the live stream — 6.3.
3. Reconnection + timestamps + stable IDs — 6.2.
4. Live provider / latency / diarization-accuracy measurement — 6.7 (needs a real streaming provider test).

## Checks

Desktop `tsc` clean, 189 tests pass; `deno check live/index.ts` clean; `stt.test.ts` + `liveMerge.test.ts` pass.
