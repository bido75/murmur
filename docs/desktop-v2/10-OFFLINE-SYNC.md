# Offline sync (Desktop V2, Phase 6)

Status as of 2026-10-29. Traced to `desktop/src/shared/queue.ts`, `queueOwner.ts`,
`desktop/src/renderer/sync.ts`, `desktop/src/main/main.ts`.

## The outbox

- Ops (`create` → `segment`/`local_segment` → `finalize`/`local_finalize`) run in order
  per recording, retried with exponential backoff capped at 10 minutes
  (`queue.ts backoffMs`). Queue state is a JSON file written atomically, so a crash
  mid-write cannot corrupt it.
- **Idempotency**: the recording row is `upsert … ignoreDuplicates`, segment uploads use
  storage `upsert` plus row `upsert onConflict(recording_id,idx)`; a retried segment
  replaces its own bytes instead of duplicating them.
- **Nothing is silently discarded**: failed ops stay queued with `lastError`; the user
  sees the pending count on home. Deleting a segment's bytes only happens after its
  upload and row both succeeded.
- **Network detection** is implicit (attempts fail, backoff grows, a 30 s flush timer
  retries); an explicit online/offline indicator is Phase 7 UI work.

## Account isolation (new in Phase 6)

The queue previously had no owner. On a shared machine, a recording queued by account A
could have been uploaded under account B's session — the wrong storage bucket prefix and
the wrong rows. Now:

- `queue-owner.json` records which account the queue belongs to.
- Before any op is added or run, `ensureOwner()` compares the recorded owner with the
  signed-in user; on a mismatch the old queue is **quarantined as
  `queue-{oldUserId}.json`** (never deleted — signing back in as that account resumes
  it) and the new account starts clean. `nextOwnerAction()` is unit-tested, including
  the signed-out edge case.
- Quarantining local-only text stores per user is a recorded limitation (the `text.json`
  scratch store is transient and keyed by recording id).

## Conflict rules

| Data | Desktop can edit it? | Rule |
|---|---|---|
| Transcript text | No (viewer is read-only; editing is Phase 7) | No conflict path exists yet; when editing arrives, server `edited_at` wins over a stale local copy and the original engine output is preserved alongside user edits |
| Notes/summaries | No | Generated server-side; regeneration is explicit |
| Titles | No (no rename UI yet) | Server is source of truth |
| Tasks | No | Server-extracted; task actions happen in the web app for now |
| Projects | Association only at recording start | Association is written once by the `create` op; conflicts cannot arise |
| Deletions | Not yet (no delete UI) | When delete arrives it must be an explicit queued op with a tombstone, never a silent local-only delete |

The honest summary: the desktop today **creates** data and never **edits** it, so there
are no conflict paths to get wrong; every rule above is a gate for the phase that adds
the corresponding editor.
