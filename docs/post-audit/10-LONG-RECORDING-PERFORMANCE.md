# 10 — Long recording and performance

Status: **NOT MEASURED** for scale scenarios. The plan below is executable when
a device/seeded dataset is available; none of it may be marked PASS from code
inspection.

## What the code claims (verified by inspection + unit tests only)

- Segments rotate at 5 min native / 2 min web (`SEGMENT_MS`, `WEB_SEGMENT_MS`).
- A 60-minute recording produces ~12 native parts, each uploaded and
  transcribed independently; parts transcribe 4-at-a-time (`mapLimited`).
- The pipeline hands over to a fresh run near its time budget
  (`PIPELINE_BUDGET_MS`, `continueLater`).
- Search RPC caps at 30 results; Ask caps context at 150k chars, 8 recordings.

## Test plan

| Test | Fixture | Measure |
|---|---|---|
| 15/30/60-minute recording | TTS or recorded speech of the length | wall time, parts produced, upload time, parts failed |
| Long transcript rendering | 60-min transcript (~9k utterances) | render time, memory, scroll jank |
| Search at scale | 500 seeded recordings | search latency p50/p95 |
| Ask over 8 recordings | seeded corpus | answer latency, context trimming correctness |
| Upload interruption at 50% | kill mid-upload | retry succeeds; no duplicate rows |
| Concurrent processing | 3 recordings finishing together | queue order, no duplicate jobs |
| Memory during long capture | 60-min device session | peak RSS, no OOM |
| Disk consumption | 60-min session | MB/min captured, pending folder size |

## Fixture generation

Use `desktop/scripts/speak.ps1` (SAPI) looped/concatenated to length, or any
long recording, then import. 60 minutes at the app's bit rate (64 kbps mono) is
roughly 28 MB — confirm against `SEGMENT_MS` accounting.