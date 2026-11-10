# Phase 0 — Repository Baseline & Feature Audit

- **Branch:** `feature/murmur-desktop-v2`
- **HEAD:** `046dd41`
- **Method:** source + schema inspection and live/local verification during the remediation session; physical-device and live-provider tests are explicitly *not* re-run here.

> Historical docs (`docs/FEATURE_AUDIT.md`, `docs/INTEGRATION_STATUS.md`, `docs/desktop-v2/`) are treated as evidence of prior status, not proof of current behavior. Statuses below reflect the current branch.

## Architecture (as-built)

```
Capture (web/Expo/Electron/extension/bots/imports)
  → durable local storage + outbox queue (desktop: src/renderer/sync.ts, shared/queue.ts)
  → Supabase Edge Functions (ingest, process-recording, live, bot, calendar, …)
  → transcription + diarization (stt.ts / mistral.ts / services.ts)
  → verification (verify.ts: quote grounding, owner mention)
  → notes generation (pipeline.ts + prompts.ts → summaries)
  → exports/shares/decks (export_data.ts, share.ts, deck.ts, docx.ts)
  → retrieval (ask/, mcp/, recall.ts, semantic.ts, trackers.ts)
```

Single relational Postgres schema (21 migrations, RLS on every table). No separate graph/queue/vector infrastructure.

## Feature inventory

Status legend: **V** verified · **IU** implemented-unverified · **P** partial · **B** broken · **M** missing · **Blk** blocked.

### Workstream 1 — Recording reliability & offline-first (P0)

| Capability | Status | Evidence |
|---|---|---|
| Mic acquisition (getUserMedia-first, no enumeration gate) | V | `capture.ts` refactor + `micFailure.ts` + `capture.test.ts` (mocked); `src/lib/mic.ts` |
| Typed mic error classification | V | `micFailure.test.ts` |
| Electron permission handler | V | `main.ts` (file:// + media/display-capture), reviewed |
| Local durable queue + crash recovery | V | `shared/queue.ts` + `recovery-restart.test.ts` |
| Offline record start (auth-independent) | V | `getSession()` is local; `enqueue` does not block on network |
| Build identifier (version+sha+time) | V | `build.mjs` define + Settings screen |
| **Physical mic capture (Brio, RDP, mobile)** | Blk | requires real devices; not testable here |
| **Formal capture state machine** (`idle→…→synced`) | P | implicit in `Capture`; not a shared contract |
| **Recording manifest / chunk receipts / sync events** | M | no tables; desktop queue is the current mechanism |

### Workstream 2 — Detailed notes & semantic accuracy (P0)

| Capability | Status | Evidence |
|---|---|---|
| Comprehensive detailed sections + conclusions | V | `prompts.ts` + `pipeline.ts` (`detailed_sections`), real before/after on 2 recordings |
| Long-transcript chunking (overlapping) | V | `chunkTranscript()` + tests |
| Detail-level selector (brief/standard/detailed) | V | `systemPrompt(detailLevel)`, settings + regenerate |
| Regeneration from stored transcript | V | `/regenerate` (`reuseTranscript`) |
| Semantic coverage + faithfulness evaluators | V | `semantic.ts`, `faithfulness.ts`, `coverage.ts` + tests + eval script |
| Transcript appendix in exports | V | `export_data.ts` + `src/lib/export.ts` |
| **Note versioning / compare / restore** | M | no `note_versions`; only `notes_schema_version` |

### Workstream 3 — Live transcription & speaker recognition (P1)

| Capability | Status | Evidence |
|---|---|---|
| Live transcription plumbing | IU | `supabase/functions/live/`, `desktop/src/renderer/live.ts`, `stt.ts` present |
| Speaker rename / utterance edit | IU | `api.ts` `setSpeakerName`, `updateUtteranceText` present |
| Custom vocabulary / dictionary | IU | `desktop/src/shared/dictionary.ts` present |
| **Streaming reliability (reconnect, dedupe, diarization quality)** | IU | not measured; needs live provider test |

### Workstream 4 — Calendar & meeting bots (P1)

| Capability | Status | Evidence |
|---|---|---|
| Calendar OAuth + event sync | IU | `calendar.ts`, `calendar_fetch.ts`, `calendar/`, `oauth/` |
| Bot scheduling/timing | IU | `bot_core.ts`, `bot_timing.ts`, `bot/` |
| Meeting briefs | P | `src/app/brief.tsx`, `api.ts getBrief` — open tasks + last meeting decisions/questions; no agenda/purpose synthesis, no persisted table |
| Follow-up email draft | P | `_shared/followup.ts` + `share/` |
| **Live provider validation (Zoom/Teams/Meet)** | Blk | PROJECT_RULES rule 10: integrations untested against live accounts |

### Workstream 5 — Cross-meeting AI & Knowledge Graph (P1)

| Capability | Status | Evidence |
|---|---|---|
| Retrieval / ask / MCP | P | `ask/`, `mcp/`, `recall.ts`, `semantic.ts` |
| Semantic topic trackers | P | `trackers.ts` |
| **Knowledge Graph model (entities/relations/assertions)** | M | no `knowledge_*` tables |
| **Decision history lifecycle** | M | no `decision_history` |

### Workstream 6 — Visual document & presentation studio (P1)

| Capability | Status | Evidence |
|---|---|---|
| Visual planning engine (layout by meaning) | V | `deck_plan.ts` + 11 tests |
| Native editable diagrams + charts + themes | V | `deck.ts` (process/timeline/pillars/kpi/comparison/chart) |
| Evidence-grounded chart validation | V | `validateChartData` |
| Provider-aware image generation | V | `deck_images.ts`; **live generation verified** (gpt-image-2 → PNG → `ppt/media/`) |
| PPTX export verification | V | `pptx_verify.ts` + CLI + tests |
| Speaker notes + enhancement toggles | V | `deck.tsx`, `make-deck` |
| DOCX/PDF export | P | `docx.ts` present; PDF via `expo-print`; not re-verified |
| **Outline preview + regeneration UI** | P | outline preview not yet built |

## Confirmed defects vs unverified hypotheses

**Confirmed & fixed this session:**
1. Mic enumeration used as a hard gate before `getUserMedia()` (Safari/RDP false "no microphone").
2. Email template filename mismatch (`magiclink.html` vs `magic_link.html`) + Docker single-file bind-mount failure → sign-in email rendered a directory listing.
3. Kong gateway down (`Exited 127`, bind-mount) → 502/530 + auth-refresh failures.
4. Deck `images` default off + images gated to `visual` layout + `gpt-image-1` rejecting 16:9 → zero images.

**Unverified hypotheses (require hardware/provider/credentials):**
1. Physical mic capture on real Windows (Brio, RDP) — evidence points to OS/RDP-level "no audio input", not a code bug.
2. Live transcription streaming quality/dedupe/diarization.
3. Calendar/bot behavior against live Google/Microsoft/Zoom/Teams/Meet.

## Migration inventory

- Existing: 21 migrations (recordings, transcripts, summaries, tasks, projects, teams, user_settings, share_links, etc.), all RLS.
- **None of the advanced tables exist** (`note_versions`, `knowledge_*`, `speaker_profiles`, `meeting_briefs`, `document_jobs`, `recording_manifests`, `decision_history`). These are the additive-migration candidates per phase; do not add until their phase is reached.

## Dependencies & risks

- **Physical-device validation** blocks Workstream 1 release gate.
- **Live-provider credentials** block Workstream 3–4 validation.
- **Docker Desktop single-file bind-mount flakiness** is an infra risk (mitigated by directory mounts + the auth template rename).
- **Image generation cost** (~$0.13/image) — needs budget + diagnostics (done).
- **Shared contracts** (recording/evidence) are stable enough to proceed on Workstreams 1–2 before 3–5.

## Prioritized tickets (initial)

1. [P0] Workstream 1 — capture state machine + offline-first harden + diagnostics panel (build on `capture.ts`/`sync.ts`).
2. [P0] Workstream 2 — note versioning (`note_versions`) + regenerate-without-overwrite.
3. [P1] Workstream 6 — outline preview + regeneration UI (build on `deck.tsx`).
4. [P1] Workstream 5 — knowledge graph model (relational, `knowledge_*` tables + extraction job).
5. [P1] Workstream 4 — meeting briefs (build on `calendar.ts`/`bot_core.ts`).
6. [P1] Workstream 3 — live transcription hardening (needs provider test).

## Decisions requiring approval

- Which phase to execute first (recommended: Workstream 1, per the directive).
- Whether to spend OpenRouter credits on further live image/LLM verification.
- Physical-device test plan (who runs the Brio/RDP/mobile matrix).
