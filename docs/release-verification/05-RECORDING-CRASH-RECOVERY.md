# 05 — Recording crash recovery

Status: **VERIFIED at integration level (new, 12 automated tests in 3 processes); physical crash/restart on hardware remains BLOCKED**

The audit FAIL (REQ-1.3b) had only pure-function tests. This sprint proves the
real modules under fault injection: the actual `recoverInterruptedRecording()`
(recorder.ts), the actual outbox (`sync.ts` `run()` loop) and the recovery
orchestration run against a real temporary file system, a file-backed
AsyncStorage double, and an in-memory Supabase client with true upsert
semantics — with controlled faults (upload 500s, function 500s, no session,
missing/corrupt files).

## Evidence (all in this branch, exact files)

| File | Tests | What it proves |
|---|---|---|
| `src/lib/recovery-crash.test.ts` | 6 | After a simulated crash: readable part in progress is **moved** (not copied) into pending storage and queued with a finalize; corrupt part skipped without deleting the file; missing part still finalizes (no recording hangs in "recording"); **running recovery twice queues nothing twice**; on-device (local) recording recovers to local segment + local finalize |
| `src/lib/recovery-restart.test.ts` | 4 | Restart with the crashed session's queue: not signed in → queue survives untouched; signed in → **create runs before any segment upload** (server sees the parent first); upload failure keeps the op with backoff, the local file is **kept until upload succeeds**, blocked siblings stay queued, **no finalize while a segment fails**; backoff prevents immediate retry; the queue on disk is exactly what the next process picks up |
| `src/lib/recovery-reopen.test.ts` | 2 | Reopen after backoff: full drain without re-creating the recording row; **every segment upload precedes the pipeline invocation** (ordered call log); finalize moves status off "recording"; audio files deleted only after their uploads succeeded; a missing local file fails loudly with a clear error and counted backoff (never silently dropped) |

## Two real defects found and fixed by these tests

1. **Queue liveness gap** (`sync.ts`): ops enqueued while a flush run was in
   flight were not processed until the next flush (30 s timer or next app
   open). A quick record→stop→background could leave the finalize undrained.
   `run()` now loops until a pass makes no progress.
2. **Non-idempotent recovery**: a crash between "ops enqueued" and "session
   marker cleared" re-enqueued duplicate segment/finalize ops on the next
   launch. Recovery now checks the existing queue and skips duplicates.

Plus the earlier pure-function guarantee still holds: even with an unreadable
partial file, a finalize is always queued.

## Honest limits

- **Mic capture lifecycle** (start/stop under expo-audio hooks, OS interruptions,
  background modes) still requires the physical-device matrix — BLOCKED
  (hardware). These tests cover persistence→recovery→upload→processing, which
  is where data loss lives.
- OS power-loss at arbitrary instants cannot be exhaustively proven anywhere;
  the design bounds loss to ≤1 segment (5 min) by construction, and the tests
  verify the bounds hold when the platform does leave the artifacts readable.
