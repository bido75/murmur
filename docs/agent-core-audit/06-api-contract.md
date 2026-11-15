# 6. API Contract Specification

Supabase Edge Functions route by path, so the directive's REST paths are adapted as one `agent/` function with sub-paths. Auth is the existing Supabase session (`requireUser`, `services.ts:83-88`); the agent runs as the caller (RLS), never service-role.

## 6.1 Endpoints

```
POST /functions/v1/agent/runs                 create a run (idempotent)
GET  /functions/v1/agent/runs/{id}            run status + steps + events
POST /functions/v1/agent/runs/{id}/resume     continue after approval/interruption
POST /functions/v1/agent/runs/{id}/cancel     cancel (only owner)
POST /functions/v1/agent/approvals/{id}/approve
POST /functions/v1/agent/approvals/{id}/reject
GET  /functions/v1/agent/runs/{id}/events     newline/paged run events (step/approval/artifact)
```

## 6.2 Create run

Request:

```jsonc
{
  "objective": "Review my last three client meetings and list unresolved commitments.",
  "idempotency_key": "req_9f8…",       // optional but recommended
  "run_id": null                          // omit to create; set to resume an existing run
}
```

Response `201`:

```jsonc
{
  "run_id": "…",
  "status": "running",                    // or "awaiting_approval"
  "plan": [{ "step_index": 0, "tool": "recordings.list", "args": {} }]
}
```

If the plan includes a mutation, execution halts at that step and returns `status: "awaiting_approval"` with the `approvals` array filled.

## 6.3 Get run

```jsonc
{
  "run_id": "…",
  "status": "awaiting_approval",
  "steps": [
    { "step_index": 0, "tool": "recordings.list", "status": "succeeded" },
    { "step_index": 1, "tool": "notes.retrieve", "status": "succeeded", "results": { /* capped */ } },
    { "step_index": 2, "tool": "followups.send", "status": "awaiting_approval" }
  ],
  "approvals": [
    {
      "id": "…",
      "action": "followups.send",
      "destination": "alice@acme.com",
      "content": "…draft…",               // exact content under approval
      "evidence": [{ "recording_id": "…", "quote_ms": 123400, "excerpt": "…" }],
      "expires_at": "2026-11-15T…Z"
    }
  ],
  "artifacts": [ { "kind": "followup_draft", "url": null, "payload": {} } ]
}
```

## 6.4 Approve / reject

```jsonc
POST /agent/approvals/{id}/approve   -> { "ok": true, "tool_call_status": "succeeded" }
POST /agent/approvals/{id}/reject    -> { "ok": true, "tool_call_status": "denied" }
```

Rejected/expired approvals cannot be replayed; `action_hash` mismatch → `409`.

## 6.5 Resume

`POST /runs/{id}/resume` re-enters the loop after the last persisted step, re-validating remaining plan steps against current policy (so a policy change between pause and resume is honored).

## 6.6 Error envelope

Reuse `HttpError`/`json` from `services.ts` with a structured shape:

```jsonc
{ "error": { "code": "approval_expired", "message": "…", "details": {} } }
```

Codes (subset): `tool_not_authorized`, `approval_required`, `approval_expired`, `action_mismatch`, `budget_exceeded`, `rate_limited`, `validation_failed`, `not_found`.

## 6.7 Cross-cutting requirements mapped to existing practice

| Requirement | How it is satisfied / reused |
|---|---|
| Authentication | `requireUser` (`services.ts:83-88`) |
| Per-resource authorization | RLS + `mcp_source.ts` `readable_*`/`can_read_recording` |
| RLS | all new tables owner-only (see 05) |
| Input validation | `mcp.ts` `needId`/`str`/`num` + object-shape checks |
| Idempotency | `agent_runs.idempotency_key`, `agent_tool_calls.idempotency_key` + writer keys |
| Pagination | `agent_steps` / `events` paged by `step_index`/cursor |
| Structured errors | envelope above |
| Execution status | `agent_runs.status` / `agent_steps.status` |
| Cost limits | `budgets.ts` + `entitlements.ts` minutes |
| Audit trail | `agent_steps`/`agent_tool_calls`/`agent_approvals` are append-only in practice |

## 6.8 Frontend contract (Phase 7, deferred)

The mobile/web client renders run status, plan, progress, approvals, and artifacts from `GET /runs/{id}` + `/events`; it never receives raw chain-of-thought (the backend exposes only concise progress summaries, per the directive).
