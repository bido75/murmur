# 3. Tool Registry Inventory

Goal: enumerate the existing capabilities that can be exposed as safe agent tools **without rewriting their business logic**, and flag what must be added before exposure.

## 3.1 A registry already exists: reuse it

`supabase/functions/_shared/mcp.ts:38-149` defines `TOOLS: Tool[]` with exactly the shape the agent needs:

```ts
type Tool = {
  name: string; description: string; inputSchema: Json;
  readOnly: boolean;
  run: (args: Json, src: Source) => Promise<unknown>;
}; // mcp.ts:23
```

It already implements strict runtime input validation (`needId` UUID check, `str`/`num` bounds — `mcp.ts:25-36`), a typed `Source` abstraction (`mcp.ts:9-20`), and a permission-aware implementation backed by RLS helpers (`mcp_source.ts:41-136`, using `readable_projects`, `readable_recording_page`, `can_read_recording`, `search_recordings_for`, `readable_tasks`).

**Recommendation:** the agent registry is a superset of this `Tool` type, adding `permissionScope`, `riskLevel: read|write|external`, and `requiresApproval`, and swapping its `Source` for the same one. No new business logic.

## 3.2 Read-only tools (safe to auto-execute)

| Tool | Existing backing | Notes |
|---|---|---|
| `projects.list` | `mcp.ts list_projects` | RLS-scoped. |
| `recordings.list` | `mcp.ts list_recordings` | Filterable by project/date. |
| `recordings.get` | `mcp_source.readableRec` + summaries | Scoped by `can_read_recording`. |
| `recordings.search` | `mcp.ts search_recordings` → `search_recordings_for` | Full-text today; **needs semantic upgrade** (Phase 2). |
| `transcripts.retrieve` | `mcp.ts get_transcript` (paged `formatTranscript`) | Already cites `[m:ss] Speaker`. |
| `notes.retrieve` | `mcp.ts get_recording_notes` | Decisions carry quotes. |
| `tasks.list` | `mcp.ts list_tasks` → `readable_tasks` | open/review/done. |
| `calendar.upcoming` | `functions/calendar/index.ts /events` | Read-only; no write. |
| `knowledge.search` | **missing** (no search over `knowledge_assertions`) | New read-only tool over verified assertions. |
| `knowledge.decision_history` | `decision_history` table (RLS) | New read-only tool; supports supersession. |

## 3.3 Mutation tools (need approval + idempotency before exposure)

| Tool | Existing backing | Gap before exposure |
|---|---|---|
| `tasks.create` | `functions/process-recording` insert path / `push-tasks` | Multi-user effect; needs approval + idempotency. |
| `tasks.update` (`set_task_status`) | `mcp.ts set_task_status` (+ ownership check `mcp_source.ts:128-135`) | **Already gated and ownership-checked** — lowest-risk mutation. |
| `notes.regenerate` | `pipeline.ts` `runPipeline({reuseTranscript:true})` | Already versioned via `note_versions`; needs approval. |
| `calendar.create_event` | **missing** (`calendar/events` is read-only) | New tool / new endpoint. |
| `documents.generate` (DOCX/PDF) | `_shared/docx.ts`, `export` | Idempotent-ish (produces artifact); needs storage path + approval. |
| `presentations.generate` | `make-deck/index.ts` | Cost (image gen) — needs budget + approval; pptx already verified. |
| `integrations.export` | `_shared/destinations.ts`, `after_ready.sendTo` | External side effect; needs approval + idempotency. |
| `followups.send` | `_shared/after_ready.ts` email path | External message; **highest risk**, mandatory approval. |

## 3.4 Tool contract (proposed)

```ts
type AgentTool = {
  name: string;
  description: string;
  inputSchema: unknown;
  permissionScope: string;            // e.g. "recordings", "project:<id>", "workspace:<id>"
  riskLevel: "read" | "write" | "external";
  requiresApproval: boolean;
};
```

## 3.5 Idempotency and approval binding

Per the directive: **do not expose a tool until its authorization, validation, and idempotency behavior is verified.** Concretely, before exposing any mutation tool, add an idempotency key to its underlying writer — the one known gap is `_shared/trackers.ts createIssue` (no idempotency key) and `destinations.*` email/Slack posts. Approvals are bound to the exact tool + args (content hash), so a recovered/re-run approval cannot be replayed against changed arguments (see `05-database-migration-proposal.md`).

## 3.6 Validation and result-schema requirements

- Reuse `mcp.ts`'s validation primitives (`needId`, `str`, `num`) and extend with object-shape checks.
- Bounded output: every tool result size-capped (transcripts already paged by `max_chars`).
- Explicit result schemas so `evidence.ts` can attach `{ recordingId, utteranceIds, startMs, excerpt }` — closing the KG `source_refs` gap noted in `01-capability-audit.md §1.3`.

## 3.7 What must NOT be exposed

- Anything granting unrestricted service-role SQL/network (the agent never gets a `service_role` client).
- Raw function-direct introspection; the model never sees secret providers or other users' data.
- `followups.send` / CRM / tracker mutations without an approval bound to the exact content hash.
