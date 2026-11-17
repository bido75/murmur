# 4. Agent Memory Design

Goal: give the agent durable, permission-aware memory **while keeping three kinds of memory separate** and never copying transcripts into history when a stable reference will do.

## 4.1 Three layers (per directive)

| Layer | What it holds | Lifespan | Backing today / to add |
|---|---|---|---|
| **Conversation memory** | current user ↔ agent turn, pending step, in-progress plan | per run | `agent_messages` (new) |
| **Task memory** | run/step/tool-call/approval state, intermediate results | until run completes/expires | `agent_runs/agent_steps/agent_tool_calls/agent_approvals` (new) |
| **Knowledge memory** | verified notes, tasks, decisions, KG assertions, source refs | durable, owner-scoped | existing `summaries`, `tasks`, `decision_history`, `knowledge_*` |

Conversational context must never be conflated with verified organizational facts: the planner keeps recent conversation, but "facts" are always re-read from `summaries`/`knowledge_assertions` with their `source_refs`, not trusted from memory.

## 4.2 Reference-based, not transcript-copy, context

- Assemble the plan context from **ids** (`recording_id`, `project_id`, `assertion_id`) and dereference on demand through the `Source` (`mcp_source.ts`).
- Transcripts are paged (`get_transcript` max_chars) and excerpts selected by `relevantLines`/semantic retrieval — never a full dump into `agent_messages`.
- `agent_memory_refs` (new) stores `(entity_id | recording_id | task_id | assertion_id)` links with the scope that authorized them, enabling "what did this run actually read?" auditing and retention/deletion cascades.

## 4.3 Reuse the Knowledge Graph; close its gaps

Reuse the existing relational tables (`knowledge_entities/aliases/assertions`, `decision_history`) rather than a new graph DB. Phase 2 additions:

1. **Entity resolution:** resolve a subject/object against existing entities by canonical name **plus alias** before inserting (today `knowledge/index.ts:91-105` only matches exact name within one run). Use the `knowledge_aliases` table transitively.
2. **Source references:** populate the full documented `source_refs` shape — `{ recordingId, utteranceIds, startMs, endMs, excerpt, verificationStatus }` — instead of only `{ recordingId, verificationStatus: 'unverified' }` (`knowledge/index.ts:121`).
3. **Verification propagation:** when `reviewAssertion` marks an assertion `verified`, also set the source `verificationStatus` so downstream retrieval can distinguish verified facts.
4. **Temporal/supersession:** retain `decision_history.status` + `supersedes_id` (`decisionLifecycle.ts`); add a `knowledge.decision_history` tool for chronological conflict review. Keep the conservative Jaccard rule; do not auto-resolve conflicts.
5. **Derived-data deletion:** assertions/entities derived from a recording are deleted when the recording is deleted (FK `on delete cascade` already covers via `recording_id` for decisions; assertions currently reference recordings only inside `source_refs` jsonb, not via FK — add an explicit link for clean retention cascades).
6. **Permission-aware retrieval:** retrieval reads only rows the caller can see, using the same `readable_*`/`can_read_recording` helpers as `mcp_source.ts`; team/org scoping is a follow-up that reuses `can_read_recording`.

## 4.4 State model (aligned with deliverable 05)

- A `run` owns ordered `steps`; each `step` owns `tool_calls`. State transitions are persisted after **every** step so interruption resumes deterministically.
- `agent_approvals` rows carry the exact action hash + expiry; an approval is single-use.
- Conversation history is capped (N recent messages) and never exported as fact.

## 4.5 Required acceptance (Phase 2)

An agent answers a cross-meeting question with correct **recording + timestamp citations**, and explicitly separates: verified facts vs speaker opinions vs unresolved claims vs conflicting statements — surfaced from `verified` flags (`verify.ts`) and `verificationStatus`, never implied by the model alone.
