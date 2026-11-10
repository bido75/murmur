# Phase 2 — Detailed Notes & Semantic Accuracy

Status: **core complete; acceptance partially blocked on human review.**

This phase builds on work already present in the branch (comprehensive `detailed_sections`, chunking, detail-level selection, semantic/faithfulness evaluators, transcript appendix) and closes the regeneration/versioning gap. Sections 5.7–5.9 are addressed explicitly below.

## 5.1–5.6 status

| Sub | Result |
|---|---|
| 5.1 existing code | Audited (`prompts.ts`, `pipeline.ts`, `verify.ts`, `coverage.ts`, `faithfulness.ts`, `notes_data.ts`, `share.ts`, `src/lib/export.ts`). The old "short bullets + transcript cap" limitation is gone: `detailed_sections` + overlapping `chunkTranscript` are in place. |
| 5.2 note modes | `brief`/`standard`/`detailed` via `detail_level` (prompt + persistence + settings + regenerate). Default full export = Detailed Notes with sections, decisions, tasks, questions, conclusions, timestamps, excerpts, transcript appendix. |
| 5.3 long-recording | Overlapping chunking; no silent truncation. |
| 5.4 semantic coverage | `semantic.ts` (LLM-judge recall), `faithfulness.ts` (deterministic quote grounding), `coverage.ts` (literal, demoted); literal and semantic reported separately. |
| 5.5 faithfulness | Every task/decision/key-point/section carries a `verify.ts`-grounded quote; speculative content is attributed, not asserted as fact. |
| 5.6 regeneration/versioning | `/regenerate` (reuse transcript), `note_versions` snapshot + restore + edit-overwrite warning. |

## 5.7 Database changes — assessment (inspect-before-add)

| Proposed table | Decision |
|---|---|
| `note_versions` | **Added** (`20261109000000`). Additive, RLS owner + teammate-read, tested. |
| `note_sections` | **Not needed.** Sections already live in `summaries.detailed_sections` (jsonb). Normalizing would add a join + migration risk for no functional gain. |
| `note_source_references` | **Not needed.** Sources are the existing `quote` + `quote_ms` + `verified` fields on each section/key-point/decision/task, resolved by `verify.ts`. |
| `note_generation_jobs` | **Not needed now.** Generation is tracked by `recordings.status` (`transcribing`/`summarizing`) + `notes_queued_at`, with retry via the scheduler/recovery. A job table is only justified if we move to a durable, resumable generation queue — out of scope for this phase. |
| `note_quality_reports` | **Deferred.** Evaluation exists (`semantic.ts`/`faithfulness.ts`/`coverage.ts` + the `coverage_metadata` column) and the eval script can run on demand; persisting a per-generation report is a follow-up once a human-reviewed benchmark set exists. |

## 5.8 API contracts — mapping

| Operation | Implementation |
|---|---|
| Generate notes (detail level) | `process-recording` `/regenerate` + `detail_level`; initial generation via `process-recording`. |
| Regenerate from transcript | `/regenerate` (`reuseTranscript`). |
| Retrieve note version | `listNoteVersions(recordingId)` (metadata) + `getNoteVersion(id)` (full snapshot). |
| Compare versions | Not yet — needs a UI; the data (full snapshots) is available via `getNoteVersion`. |
| Retrieve source references | Embedded in the summary (quote/quote_ms/verified); no separate endpoint (no separate source table). |
| Retrieve quality report | Not persisted; run `scripts/evaluate-notes-quality.mts` on demand. |
| Async/cancel/retry/progress | Async: yes (edge function + status). Cancel/progress: not exposed; retry: scheduler/recovery. |

## 5.9 Acceptance criteria — status

| Criterion | Status |
|---|---|
| Short/long recordings, no silent loss | ✅ chunking |
| Major topics + details preserved | ✅ detailed sections |
| Source references resolve to utterances | ✅ `verify.ts` |
| No fabricated citations | ✅ quote verification |
| User edits survive regeneration | ✅ preserved as a version + explicit confirm before overwrite |
| Detailed notes export consistently | ✅ transcript appendix (markdown/HTML/PDF) |
| Backward compatibility | ✅ additive columns only |
| Semantic eval includes human-reviewed benchmarks | ⛔ **outstanding** — the evaluator exists, but no human-reviewed benchmark set has been produced/reviewed (requires operator). |

## Remaining (explicit)

1. Human-reviewed benchmark recordings (5.9) — operator-owned.
2. Side-by-side version compare UI (uses `getNoteVersion`).
3. Persisted `note_quality_reports` (after benchmarks exist).
