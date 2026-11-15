# 10. Go/No-Go Recommendation

**Verdict: GO (conditional).** Murmur's existing infrastructure is ready for native agent orchestration — the work is additive, not a rewrite.

## Why GO

1. **A typed, validated tool registry already exists.** `_shared/mcp.ts:38-149` is a working 7-tool registry with strict input validation and read/write hints — exactly the shape an internal agent needs. The seed for the agent registry is already unit-tested.
2. **A permission-aware read layer already exists.** `_shared/mcp_source.ts:41-136` resolves "what this user may read" through `readable_projects` / `readable_recording_page` / `can_read_recording` / `search_recordings_for` / `readable_tasks` — the same RLS rules the app uses.
3. **Grounding and citation machinery already exists.** `verify.ts findQuote`, `faithfulness.ts buildTranscriptIndex`, `quote_ms` on key points/decisions/tasks, and the quote-enforcement invariant in `PROJECT_RULES.md`.
4. **Bounded execution already exists at the low level.** Provider timeouts, pipeline handoff caps, transcript/token caps, and a billing-minute gate (`entitlements.ts`) — the agent only needs to add loop-level budgets.
5. **The data model supports additive memory.** Relational KG + decision lifecycle are present and RLS-tested; only entity resolution, richer `source_refs`, and permission-aware retrieval are missing.

## Conditions to satisfy before Phase 1 code is considered "done" (not for this audit, which is read-only)

1. Phase 0 documents reviewed and approved by a human (this deliverable).
2. New tables land as an **additive** migration with RLS + outsider/teammate tests (`PROJECT_RULES.md` rule 3).
3. The agent runs under `requireUser` + RLS, never service-role (`services.ts:76` discipline).
4. Mutation tools are exposed only after idempotency (esp. `trackers.createIssue`, `destinations.*`) and approval binding (`action_hash` + expiry) are in place.
5. Prompt-injection, cross-tenant, and partial-failure scenarios (Phase 10 G/H/I) pass before any `followups.send`/export tool is enabled.

## What would flip us to NO-GO

- A requirement forcing service-role access for the agent (rejected by design).
- A requirement for unbounded autonomous loops or LLM-executed SQL/network.
- Any evidence that the existing RLS scope (`can_read_recording`, team sharing) is insufficient for the privacy promise — in which case fix RLS first, unrelated to the agent.

## Bottom line

No LiveKit, no external agent framework, no Supabase replacement. The shortest path to an MVP is: **port the MCP tool registry into an internal bounded orchestrator, persist runs/steps/approvals in Postgres with RLS, and wire the existing read layer.** That yields the three recommended capabilities — Research Agent, Meeting Preparation Agent, Action Agent — on top of infrastructure that is already present and tested.

**Next step:** human review of Phase 0, then approved Phase 1 kickoff only. No merge/deploy/migration until approved.
