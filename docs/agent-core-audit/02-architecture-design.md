# 2. Agent Architecture Design

Goal: add a bounded, stateful, tool-using orchestration layer on top of Murmur's existing Supabase infrastructure — **without** replacing the LLM provider abstraction, the recording pipeline, or Supabase.

## 2.1 Design principle

The agent is a **deterministic state machine that uses the LLM only to decide the next bounded action** — never to execute code, SQL, or network calls. "Tool" means a typed adapter that calls Murmur's existing functions/services; the model only proposes which tool and its arguments, which the executor validates and runs.

This mirrors the pattern already proven in `_shared/mcp.ts` (typed tools + validation + scoped `Source`), extending it from "serve external clients" to "drive an internal run loop".

## 2.2 Component map

```
              ┌──────────────────────────────────────────────┐
              │              agent/index.ts (Edge FN)          │
              │  auth → intent → plan → execute → persist     │
              └──────┬───────────────────────────────────┬────┘
                     │                                   │
   ┌─────────────────┴───────────────┐    ┌──────────────┴─────────────┐
   │  _shared/agent/ (new)           │    │  existing (reused)          │
   │   types, orchestrator, planner, │    │  services.llmStructured,    │
   │   registry, policies, context,  │    │  mcp.ts TOOLS[],            │
   │   executor, approvals, evidence,│    │  mcp_source.ts (read layer),│
   │   budgets, errors               │    │  pipeline.ts, verify.ts,    │
   └─────────────────┬───────────────┘    │  trackers.ts, destinations, │
                     │                    │  deck*/docx exporters       │
                     ▼                    └──────────────┬─────────────┘
      Postgres (new tables): agent_runs/steps/messages/approvals/tool_calls/artifacts
                     │
                     ▼
         RLS-scoped data: recordings, transcripts, summaries, tasks,
         projects, calendar_links, knowledge_*, decision_history
```

## 2.3 Execution loop (`orchestrator.ts`)

Bounded loop with hard limits (see §08 budgets):

1. `agent/index.ts` authenticates the user (`requireUser`).
2. Load or create an `agent_runs` row (durable idempotency + resume).
3. Resolve scope: `mcp_source.makeSource(db, userId)` — the same permission-aware read surface the MCP server already uses.
4. Classify intent (cheap, one structured call) → choose a policy profile.
5. Assemble context from **stable references** (recording/project/task ids), never by copying full transcripts into history.
6. Generate a proposed plan (bounded step list) via `llmStructured`.
7. Validate the plan against the registry + policy (no unsupported/unapproved tools).
8. Execute read-only tools directly (scoped by RLS).
9. For mutations: emit an `agent_approvals` row and return `requires_approval` to the client.
10. On approval, execute the mutation (idempotency key), verify the result, record evidence.
11. Persist run state after every step (progress/resume).
12. Return an evidence-backed summary with citations.

The LLM is called **only** in steps 4/6 and as a grounder; tool **execution** is real code.

## 2.4 Key modules and relationship to existing code

| New module | Responsibility | Reuses |
|---|---|---|
| `types.ts` | `AgentTool`, `RunState`, `Step`, `Approval`, `ToolResult`. | Mirrors `mcp.ts:23` `Tool`. |
| `registry.ts` | Static allowlist of tools + `riskLevel`/`requiresApproval`/`readOnly`. | Seeds from `mcp.ts:38-149` `TOOLS[]`. |
| `policies.ts` | Which (tool, resource) pairs are auto vs approval vs denied. | Mirrors `services.ts:76` ownership-check discipline. |
| `context.ts` | Reference-based context assembly + context-window budgeting. | Extends `ask_retrieval.ts` + `mcp_source.ts`. |
| `executor.ts` | Runs a validated tool call, bounds output, records result. | Calls existing `_shared` services (never new business logic). |
| `approvals.ts` | Creates/validates/expires approvals, binds to an exact action hash. | New table, RLS. |
| `evidence.ts` | Collects per-step `{source_refs}` with utterance citations. | Extends `faithfulness.ts` index + `verify.ts` `findQuote`. |
| `budgets.ts` | Step/tool/token/time/cost caps. | Complements `entitlements.ts` + `services.ts` timeouts. |
| `errors.ts` | Structured, retryable/non-retryable errors; partial-failure reporting. | Complements `_shared/errors.ts` + `HttpError`. |
| `planner.ts` | Plan synthesis + validation. | Uses `llmStructured` with one planning schema. |

## 2.5 Data flow for the canonical request

"Review my last three client meetings, identify unresolved commitments, prepare a follow-up, but don't send it."

1. `POST /agent/runs` → orchestrator classifies intent = `research + draft-followup` (mutation) .
2. Planner proposes: `[list_recordings, get_recording_notes ×3, get_transcript (targeted), list_tasks, prepare_followup_draft]`.
3. Read-only tools run automatically (`list_recordings` → `get_recording_notes` → scoped transcript retrieval → `list_tasks`).
4. `facts` are grounded with `quote_ms` via the existing `findQuote`/`buildTranscriptIndex`.
5. Draft step (`followup.draft` → local artifact, no external side effect) is created as an `agent_artifacts` row.
6. Any `followup.send` is **not** executed: it is a `requiresApproval` mutation → the run returns `awaits_approval` with the draft + destination + evidence.
7. On approve, `followup.send` runs with an idempotency key, records the recipient/result, and the run publishes a final summary.

## 2.6 What is deliberately NOT done

- No new graph database (Postgres relational tables remain the source of truth).
- No agent framework (LangChain etc.) — a ~200-line in-house loop is sufficient given `llmStructured` exists.
- No rewrite of `pipeline.ts`, `verify.ts`, or the document builders.
- No duplicate task/calendar/KG systems — the agent calls the existing ones by id.
- No LiveKit / real-time platform.

## 2.7 Dependencies and sequencing risk

- **Depends on** `agent_runs/steps/approvals` tables (deliverable 05) and the tool registry (03) before the orchestrator can persist/execute.
- **Lower risk** if Phase 1 first exposes only the 6 read-only MCP tools (already unit-tested in `mcp.ts`); mutations (Phase 4) come later, after idempotency is added to `trackers.createIssue`.
