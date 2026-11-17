# Murmur Native AI Agent Core — Phase 0 Audit

**Status:** Read-only Phase 0 audit. No code was implemented, merged, deployed, or migrated.
**Branch audited:** `feature/murmur-desktop-v2` @ `65d285a`.
**Scope:** Existing Murmur infrastructure only. LiveKit and other real-time platforms are out of scope.

This directory holds the Phase 0 deliverables required before any Phase 1 (agent orchestration) work begins.

## Documents

| # | Deliverable | File |
|---|---|---|
| — | Index / executive summary | `00-README.md` (this file) |
| 1 | Native Agent Capability Audit (features + gap matrix + 12-question findings) | `01-capability-audit.md` |
| 2 | Agent Architecture Design | `02-architecture-design.md` |
| 3 | Tool Registry Inventory | `03-tool-registry-inventory.md` |
| 4 | Agent Memory Design | `04-memory-design.md` |
| 5 | Database Migration Proposal (schema + RLS) | `05-database-migration-proposal.md` |
| 6 | API Contract Specification | `06-api-contract.md` |
| 7 | Security Threat Model | `07-security-threat-model.md` |
| 8 | Performance and Cost Model | `08-performance-cost-model.md` |
| 9 | Phased Engineering Backlog | `09-engineering-backlog.md` |
| 10 | Go/No-Go Recommendation | `10-go-no-go.md` |

## Executive summary

Murmur already has most of the **raw material** an agent needs, but none of the **orchestration**:

- **Strong foundations that already exist and are tested:** a three-provider LLM abstraction with structured-output ("tool") schemas (`_shared/services.ts`); a quote-grounded verification layer (`_shared/verify.ts`, `_shared/faithfulness.ts`); a permission-aware read layer backed by SQL RLS helpers (`_shared/mcp_source.ts`); a **typed tool registry with strict input validation** already used by the existing MCP server (`_shared/mcp.ts`); a deterministic, resumable, budgeted recording pipeline (`_shared/pipeline.ts`); a relational knowledge graph with owner-only RLS and a human review loop (`knowledge/`, `decisionLifecycle.ts`); and a billable minute/entitlement gate (`_shared/entitlements.ts`).
- **What is missing is a controlled orchestration layer:** no central agent runtime, no multi-step tool loop, no durable run/step/message state, no approval gate that pauses and resumes, no utterance-level citation in the Ask answer path, no semantic retrieval, and no cross-meeting contradiction detection beyond a conservative decision-supersession heuristic.

The single most important positive finding is that **Murmur already models "tools" correctly** — `_shared/mcp.ts` `TOOLS[]` is a typed, read-hint-carrying, strictly-validated tool registry (7 tools, 6 read-only, 1 gated mutation) with a clean database-backed `Source` abstraction. This is the reusable seed for the internal agent tool registry; the missing work is wiring it to a bounded multi-step executor rather than only serving external MCP clients.

**Recommendation:** GO (conditional). Build the agent natively on Supabase Edge Functions + Postgres, reusing the MCP tool pattern, the `_shared` pure-logic convention, and RLS. See `10-go-no-go.md` for conditions and `09-engineering-backlog.md` for the phased plan. No external agent framework and no LiveKit are required.

## Rules honored

This audit followed `docs/agent/PROJECT_RULES.md` and the directive's execution boundaries:

- Read-only: nothing implemented, merged, deployed, or migrated.
- No LiveKit, no agent framework, no Supabase replacement, no rewrites of recording/notes/document pipelines, no duplicate task/calendar/KG systems.
- Findings are cited with `file:line` references to the code actually inspected at HEAD `65d285a`.
