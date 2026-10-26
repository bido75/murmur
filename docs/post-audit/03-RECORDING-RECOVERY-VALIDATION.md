# 03 — Recording recovery validation

## What was verified

The recovery decision (`src/lib/recoveryPlan.ts`, extracted from
`recorder.ts#recoverInterruptedRecording`) is now covered by 5 Node tests
(`src/lib/recoveryPlan.test.ts`):

| Case | Asserted |
|---|---|
| Session + readable partial file | part is enqueued (`segment` or `local_segment`) with correct idx/uri/offset, then `finalize`/`local_finalize` |
| On-device (local) session | WAV part recovered without `ext`, `local_finalize` used, offset preserved |
| **Unreadable/truncated partial file** | part skipped, but **the recording still finalizes** — earlier parts are kept and nothing hangs in "recording" forever |
| No interrupted session | no operations, null id |
| Every real session case | a finalize is **always** the last op |

The test file fails if `recoveryPlan` stops queueing a finalize — the exact
data-loss regression the audit demanded protection against.

## Failure-scenario coverage

| Scenario from the prompt | Covered by |
|---|---|
| App termination during recording | recovery plan tests (restart path) + SQLite-queued ops survive restart (`sync.ts` KEY persistence, design-verified) |
| Partial-file unreadable / corrupted | recovery plan test: skipped, finalize still queued, no crash |
| Network loss during upload | queue persistence + retry (Settings → Retry now); audio deleted only after successful upload (`sync.ts` design, DB tests) |
| Transcription provider failure | fallback engine + retry (unit-tested, real-run verified) |
| AI processing failure | recording marked failed, audio retained (DB tests) |
| Duplicate retry | `sttCacheKey` + `segment_transcripts` (unit + db tests) |
| Browser refresh during recording | web path: MediaRecorder parts finalize every 2 min (`WEB_SEGMENT_MS`); recovery plan applies on reload |
| Low storage / permission revocation | not fault-injected — **BLOCKED (hardware/platform)** |

## What is still not proven

- A real crash-and-restart on a physical device (the plan logic is tested; the
  OS-level persistence of AsyncStorage + the file across a crash is platform
  behavior) — **BLOCKED (hardware)**.
- Sudden power failure cannot be guaranteed by any web/mobile stack and is not
  claimed.