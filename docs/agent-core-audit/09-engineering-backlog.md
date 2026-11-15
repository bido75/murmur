# 9. Phased Engineering Backlog

Priorities from the directive: Phase 0 P0, Phase 1 P0, Phase 2 P0, Phase 3–5 P1, Phase 6 P0. Each ticket is independently testable. Nothing is implemented yet.

## Phase 0 — Audit (this work) — DONE for read-only findings

- [x] Capability audit + matrix (`01-capability-audit.md`)
- [x] Architecture, tool registry, memory, migration, API, threat, perf, backlog, go/no-go (this directory)

## Phase 1 — Orchestration + tool registry (P0)

1. `agent_core` migration + RLS test (`05-database-migration-proposal.md`, `supabase/tests/agent-core.test.mjs`).
2. `_shared/agent/types.ts` + `registry.ts`: port `mcp.ts TOOLS[]` into `AgentTool` with `permissionScope`/`riskLevel`/`requiresApproval`; 6 read-only tools live; no mutations yet.
3. `_shared/agent/orchestrator.ts` + `executor.ts`: bounded loop, strictly validated tool dispatch, read-only execution only.
4. `functions/agent/index.ts`: `POST /runs`, `GET /runs/{id}`, `POST /resume`, `POST /cancel` with `requireUser`.
5. `_shared/agent/budgets.ts` + `errors.ts`: step/tool/time/token caps + structured errors.
6. Gate: `npx tsc --noEmit`, `npm test`, `deno check`/`deno test`; read-only research scenario (Phase 10-A) green.

## Phase 2 — Grounded retrieval + memory (P0)

1. Hybrid retrieval: add semantic ranking to `search_recordings_for` (embed via configured provider), keep FTS as recall; expose `recordings.search` with reranking.
2. Utterance-level citations in the Ask/agent path: reuse `faithfulness.buildTranscriptIndex` + `verify.findQuote`; return `{recording_id, start_ms, excerpt}` in tool results.
3. Close KG gaps (`04-memory-design`): entity resolution via aliases, populate full `source_refs`, propagate `verificationStatus`, `knowledge.search`/`knowledge.decision_history` tools, derived-data deletion.
4. Contradiction/insufficient-evidence: explicit "not enough evidence" + "conflicting statements" outputs.
5. Gate: Phase 10-A cross-meeting citation test; fact-vs-opinion-vs-conflict separation.

## Phase 3 — Meeting intelligence agent (P1)

1. Pre-meeting: `brief` reuse as a tool (`projects.retrieve` + `notes.retrieve` + `tasks.list` + `calendar.upcoming` → agenda) — mostly exists; wrap + ground it.
2. During: observe finalized transcript segments; incremental topic/decision markers; no irreversible actions from provisional transcript.
3. After: detailed notes (existing) + compare commitments + follow-up drafts (require review).

## Phase 4 — Project & action agent (P1)

1. Add idempotency keys + approval gating to mutation writers (`trackers.createIssue`, `destinations.*`); add `calendar.create_event`.
2. Approval UX (`agent_approvals`) with exact content + destination + evidence; single-use + expiry.
3. `followups.send`, `tasks.create` (verified commitments), `integrations.export` as approval-gated tools.
4. Gate: Phase 10-C/D/I (follow-up + task creation + partial failure).

## Phase 5 — Document & presentation agent (P1)

1. `documents.generate`, `presentations.generate` tools wrapping existing `make-deck`/DOCX/PDF exporters; outline review; artifact + provenance return.
2. No invented numbers/decisions; pptx verification (already in `make-deck`) stays as the gate.
3. Gate: Phase 10-F.

## Phase 6 — Evaluation, security, performance, release gates (P0)

1. Security gates per `07-security-threat-model.md`: prompt injection (T1), cross-tenant (T3), approval replay (T4), SSRF (T5).
2. Performance/cost benchmarks per `08-performance-cost-model.md`; rate limiting; budget governor.
3. Full regression: existing app tests + db security tests + Phase 10 A–J scenarios; feature flags off until gates pass (ROADMAP M2).
4. Go-live: hold until `10-go-no-go.md` conditions are all green and user approves deploy.

## Expressed out of scope

LiveKit; new graph DB; new agent framework; recording/notes/document pipeline rewrites; duplicate task/calendar/KG systems.
