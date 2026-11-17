# Phase 4 — Calendar Bots & Meeting Preparation

Status: **audited; mostly implemented. Correction to the Phase 0 baseline: the meeting brief and follow-up draft already exist.**

## 7.1 Existing implementation (audited)

- `_shared/calendar.ts`, `_shared/calendar_fetch.ts`, `calendar/`, `oauth/` — Google/Microsoft OAuth + upcoming-event fetch + project linking (recurring-series → project).
- `_shared/bot_core.ts`, `_shared/bot_timing.ts`, `bot/`, `scheduler/` (`autobot`) — notetaker scheduling/timing.
- **Meeting brief** — `src/app/brief.tsx` + `api.ts getBrief()`: shows meeting title/date/attendees, the project picker (remembered per series), "Still open" tasks, and "Last time" (last recording's overview + verified decisions + open questions), with Record/Join/Send-notetaker/consent actions.
- **Follow-up email draft** — `_shared/followup.ts` (`followupMaterial`/`followupSystem`) + `share/`.
- `src/app/upcoming.tsx`, `src/app/(tabs)/index.tsx` — next/upcoming meeting surface.

## 7.2–7.7 gap matrix

| Capability | Status |
|---|---|
| Google/Microsoft OAuth + events | IU (needs live account) |
| Upcoming dashboard + project linking | ✅ present |
| Meeting brief (tasks/decisions/questions) | ✅ present |
| Suggested agenda / purpose synthesis | ❌ not built (the one concrete content gap) |
| Multiple relevant previous meetings (vs "last" only) | ❌ brief shows only the most recent |
| Bot join / consent / waiting-room / reconnect | IU (needs live Zoom/Teams/Meet) |
| Follow-up email draft | ✅ present (approval-gated in `share/`) |
| Live provider validation | Blk (PROJECT_RULES rule 10) |

## Remaining (explicit)

1. **Suggested agenda** (7.4): LLM-synthesized agenda + purpose from the project's open tasks, decisions, and questions — the one missing brief component. (Deterministic fallback: group open tasks/questions.)
2. Multiple prior recordings in the brief (not just the latest).
3. Live-provider validation of Zoom/Teams/Meet (blocked on credentials).

## Note

The Phase 0 baseline incorrectly listed "meeting briefs / follow-up drafts" as missing; corrected to **partial** in `feature-matrix.csv` and `00-baseline.md`.
