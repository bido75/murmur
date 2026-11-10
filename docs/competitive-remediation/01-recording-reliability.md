# Phase 1 — Recording Reliability & Offline-First

Status: **in progress** (code done for state machine + diagnostics; physical-device validation blocked on hardware).

## 4.1 Capture state machine — done

`desktop/src/shared/captureState.ts` (pure) defines the recording lifecycle:

```
idle → requesting_permission → acquiring → recording → paused
      → finalizing → locally_saved → sync_pending → synced (+ error)
```

- Explicit transition table; illegal transitions are a no-op (caller surfaces an error).
- `isLiveRecording()` / `isLocallySaved()` helpers.
- Wired into `desktop/src/renderer/capture.ts` (`phase` tracked through start/pause/resume/stop; capture owns up to `locally_saved`, the upload outbox owns `sync_pending`/`synced`).
- Tests: `captureState.test.ts`.

## 4.2 Universal microphone handling — done (earlier)

- `getUserMedia()` is the authoritative attempt; `enumerateDevices()` is diagnostic only (never a gate).
- Typed errors (`NotFoundError`/`NotAllowedError`/`NotReadableError`/`OverconstrainedError`/`AbortError`/`SecurityError`) → actionable, platform-aware messages via `micFailure.ts`.
- Live-track verification; leak-free cleanup. Tests: `capture.test.ts`, `micFailure.test.ts`.

## 4.3 Microphone diagnostics — done

- `desktop/src/shared/micDiagnostics.ts` (pure): sanitized snapshot — inputs, selected, permission, track state, level, error, camera/remote-only flags. No device ids. Tests: `micDiagnostics.test.ts`.
- Desktop settings "Check microphone" action renders the snapshot + RDP guidance (`app.ts`).
- Build identifier (version + commit SHA + build time) shown in settings (`b1b3516`).
- **Not yet:** live level meter + short test recording/playback (next increment).

## 4.4 Offline-first storage — audited: existing outbox is sufficient

The desktop outbox (`renderer/sync.ts`, `shared/queue.ts`, `shared/queueOwner.ts`, main-process file store) already satisfies every 4.4 requirement — **no new tables are warranted**:

| Requirement | Existing mechanism |
|---|---|
| Start without backend | `enqueue()` is local; `getSession()` is a local cache read |
| Durable audio chunks | `segmentAppend` → on-disk, 5-min segments |
| Local recording manifest | `activeSet()` (`recorder.active.v1`: `{recordingId, idx, ext, doneMs, local}`) |
| Chunk upload status | queue ops (`create`/`segment`/`finalize`) + `attempts`/`nextAt`/`lastError` |
| Resume interrupted uploads | `recoverInterrupted()` queues the active part + finalize |
| Deduplicate retries | `runnable()` runs first-op-per-recording in order; `onConflict`/`upsert` idempotency |
| Recover after restart | `activeGet` + `recoverInterrupted` |
| Preserve during token-refresh failure | queue persists on disk; backoff retry |
| Never upload under wrong account | `queueOwner`/`ensureOwner` quarantine (`rotate`) on account switch |
| Never delete before remote confirm | `fileDelete` only after `storage.upload` **and** `recording_segments.upsert` succeed |

## 4.5 Auth/sync isolation — audited

- `flush()` is single-flight (`running ??= run()`); `markFailed` applies exponential backoff (5s→10m, no jitter yet).
- The earlier `/auth/v1/token` retry loop was caused by the **Kong gateway outage** (now fixed), not an uncontrolled client loop; supabase-js `autoRefreshToken` self-limits.
- **Minor TODO:** add jitter to `backoffMs`.

## 4.6/4.7 Database & API — no change needed

No new tables or endpoints are justified: the existing `recordings`, `recording_segments`, `transcripts`, storage buckets, and the outbox already cover the requirements. (Kept per the directive's "inspect before adding".)

## 4.8 Acceptance — blocked on physical devices

Cannot be run here: Brio webcam, Remote Desktop, laptop/USB mic, Android/iOS capture, and the crash/recovery-on-real-device matrix. These require an operator with the hardware.

## Next increments

1. Live level meter + test recording/playback in the diagnostics card.
2. Backoff jitter (`backoffMs`).
3. Physical-device validation matrix (operator-owned).

## Checks

Desktop: `tsc` clean, `node build.mjs` clean, 185 tests pass (0 fail).
