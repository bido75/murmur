# 1. Native Agent Capability Audit

Read-only audit of Murmur's intelligence features at `feature/murmur-desktop-v2` @ `65d285a`. Every claim is cited to the source inspected.

## 1.1 AI processing — what exists

| Component | Location | Nature |
|---|---|---|
| LLM provider abstraction | `supabase/functions/_shared/services.ts:327-473` | `llmProvider()` picks anthropic/openrouter/ollama; `llmText()` and `llmStructured()` wrap `callClaude`/`callOpenRouter`/`callOllama`. |
| Structured-output "tool" | `_shared/services.ts:311-315, 440-459` | `StructuredTool` (name/description/input_schema); `llmStructured` forces a single `tool_choice` and returns `block.input`. **One tool per call, not a tool selection.** |
| Speech transcription | `_shared/services.ts:246-279` | Deepgram/Mistral with fallback order, transient-retry, keyterms, diarization, redaction. |
| Notes pipeline | `_shared/pipeline.ts` | Multi-stage: transcribe segments (4 at a time, cached) → match speakers → structured notes (chunked) → verify → persist → note versioning → decision lifecycle → after-ready hooks. Deterministic, **not goal-driven**. |
| Notes prompts/schema | `_shared/prompts.ts:142-220` | `NOTES_TOOL` schema with verbatim-quote rules, commitment-vs-suggestion, owner_basis. |
| Quote grounding / verification | `_shared/verify.ts:97-136` | `findQuote` (exact + ≥80% fuzzy) returns `quote_ms`; `verifyActionItems`/`verifyKeyPoints`/`verifyTaskUpdates`; `dropRepeats`. |
| Evidence verification | `_shared/faithfulness.ts` | `buildTranscriptIndex` + `findQuote` + `verifySectionQuotes` proves an excerpt was spoken and measures drift. |
| Semantic quality eval | `_shared/semantic.ts` | Coverage recall + faithfulness scoring via pure functions + LLM judge. An evaluator, **not a planner**. |

## 1.2 Question answering and retrieval

| Component | Location | Finding |
|---|---|---|
| Ask endpoint | `supabase/functions/ask/index.ts` | Single `llmText` (line 58). No tool loop, no multi-step. `MAX_CONTEXT_CHARS = 150_000` (line 8). Returns recording-level sources only (line 61). |
| Cross-recording selection | `ask/index.ts:30-39` | `search_transcripts` RPC (max 8) else fallback to 5 recent `ready` recordings. |
| Keyword extraction | `_shared/ask_retrieval.ts:11-13` | `askKeywords` (normalize + stopwords). |
| Excerpt selection | `_shared/ask_retrieval.ts:16-28` | `relevantLines` — keyword-hit line ±1 context, max 60 lines. |
| Transcript search SQL | `supabase/migrations/20261015020000_teams_and_api.sql:154-163` | Postgres full-text search (`websearch_to_tsquery('simple')` + `ts_rank`), scoped by `can_read_recording`. Keyword/token-based, **not semantic**. |
| Recall adapter | `_shared/recall.ts`, `functions/bot/index.ts` | Recall.ai meeting-bot adapter (webhook signature, status mapping). **Not** an agent memory service. |

## 1.3 Knowledge and memory

| Component | Location | Finding |
|---|---|---|
| KG extraction | `functions/knowledge/index.ts:66-129` | One `llmStructured` over verified notes → entities + assertions, persisted as `review_status = 'proposed'`. |
| Human review loop | `knowledge/index.ts:133-171` | `/list` and `/review` (verified/rejected), owner-only. |
| KG schema + RLS | `supabase/migrations/20261109010000_knowledge_graph.sql` | `knowledge_entities`/`aliases`/`assertions`/`decision_history`, all RLS owner-only. |
| Decision supersession | `_shared/decisionLifecycle.ts:17-34` | Conservative Jaccard (threshold 0.6) token-overlap. |
| KG RLS test | `supabase/tests/knowledge.test.mjs` | Owner build/read; outsider fully blocked. |

**Knowledge gaps found (precise):**
1. `knowledge/index.ts:121` writes `source_refs` as only `{ recordingId, verificationStatus: 'unverified' }` even though the migration documents richer fields (`utteranceIds`, `startMs`, `endMs`, `excerpt`). → KG assertions are **not utterance-cited** today.
2. That `verificationStatus` is never flipped (reviewing an assertion in `reviewAssertion` updates `review_status`, line 168, not the `source_refs` status). → source-level verification status is stale.
3. Entity resolution is per-extraction only (`knowledge/index.ts:91-105` — a lowercase-name map inside one run); aliases are stored but not used to merge across extractions, except exact upsert on `(user_id, kind, name)`.

## 1.4 Meeting intelligence

| Component | Location | Finding |
|---|---|---|
| Live transcript | `functions/live/index.ts:19-29` | Short-lived Deepgram token + `wss` URL + keyterm hints. No LLM during recording. |
| Brief/agenda | `functions/brief/index.ts:63-67` | Single `llmStructured` over open tasks + last meeting decisions/questions/overview → 3-7 items. |
| Calendar | `functions/calendar/index.ts` | OAuth connect + `/events` (list upcoming). **No create-event endpoint.** |
| Meeting bot | `functions/bot/index.ts` | Recall.ai schedule/cancel/webhook; signature-verified; `alreadyCollected` idempotency guard (line 114). |

## 1.5 Automation and external actions

| Component | Location | Finding |
|---|---|---|
| After-ready | `_shared/after_ready.ts:63-104` | Deterministic rules: webhooks (SSRF-guarded, lines 35-44) → automations → topic alerts. Each action try/caught; failures never fail the recording. |
| Automations | `_shared/after_ready.ts:118-161` | Fixed action types: `slack`/`export`/`email`/`webhook`/`tracker`. **Rules-driven, not goal-driven.** |
| Tracker adapters | `_shared/trackers.ts` | 9 providers (`verifyToken`/`listTargets`/`createIssue`). No idempotency key on `createIssue`. |
| Export destinations | `_shared/destinations.ts` | Slack/Notion/Google Docs/OneNote/HubSpot/Salesforce + OAuth refresh. |
| Task push | `functions/push-tasks/index.ts` | Per-task push with skips (dismissed / `needs_review` / already-sent via `external[provider].url`); per-result report; max 50. |
| Billing gate | `_shared/entitlements.ts` | Free/paid minutes, `notesAllowed` defers processing when out of minutes. |

## 1.6 Documents and presentation

| Component | Location | Finding |
|---|---|---|
| Deck generation | `functions/make-deck/index.ts` | Verified-notes → `llmStructured` deck plan → `buildPptx` → `inspectPptx` verify → storage. Image budget + provider config; failures degrade to placeholders. |

## 1.7 Capability matrix

Legend: **V** = implemented & verified (tested), **U** = implemented but unverified (untested against live systems), **P** = partial, **B** = broken, **M** = missing, **X** = blocked by external dependency.

| Capability | Location | Status | Agent-tool ready? |
|---|---|---|---|
| LLM text/structured calls | `_shared/services.ts` | V | Yes (but single-call) |
| Speech transcription + fallback | `_shared/services.ts:246-279` | V | Read-only tool candidate |
| Notes generation | `_shared/pipeline.ts` | V | `notes.regenerate` candidate |
| Quote grounding / citation | `_shared/verify.ts`, `_shared/faithfulness.ts` | V | Foundation for citations |
| Semantic coverage/faithfulness eval | `_shared/semantic.ts` | V | `notes.verify` candidate |
| Ask (single-pass) | `ask/index.ts` | V (logic) / U (retrieval quality) | Needs redesign |
| Retrieval (FTS keyword) | `ask_retrieval.ts`, `search_transcripts` | P (no semantic) | Needs hybrid search |
| MCP server + typed tool registry | `_shared/mcp.ts:38-149` | V (unit-tested) | **Yes — reuse directly** |
| Permission-aware read layer | `_shared/mcp_source.ts:41-136` | V | Yes |
| Knowledge Graph extraction | `knowledge/index.ts` | V (RLS-tested) | Partial (no entity resolution) |
| Decision lifecycle | `_shared/decisionLifecycle.ts` | P (Jaccard only) | Partial |
| Brief/agenda | `brief/index.ts` | V | Yes (read-only) |
| Calendar events | `calendar/index.ts` | P (list only, no create) | `calendar.upcoming` yes; `create` missing |
| Meeting bot | `bot/index.ts`, `_shared/recall.ts` | U / X (live Recall account) | Not agent reasoning |
| Automations | `_shared/after_ready.ts` | V (deterministic) | Mutation tools (need approval) |
| Tracker/export integrations | `trackers.ts`, `destinations.ts` | U (rule 10: untested live) | Mutation tools (need idempotency) |
| Deck/document generation | `make-deck/index.ts` | V (pptx verified) | `presentations.generate` candidate |
| Central agent orchestrator | — | **M** | — |
| Multi-step tool loop | — | **M** | — |
| Durable agent run state | — | **M** | — |
| Approval pause/resume | — | **M** (only KG review + task `needs_review`) | — |
| Semantic retrieval | — | **M** | — |
| Cross-meeting contradiction detection | — | **M** (only decision supersession) | — |
| Tool-permission / budget governor | — | **M** | — |

## 1.8 Answers to the twelve required questions

1. **Central agent orchestrator?** **No.** No `agent/` function or `_shared/agent/`. Each intelligence surface (`ask`, `brief`, `make-deck`, `knowledge`, `pipeline`) is an independent single-call endpoint.

2. **LLM choose from a typed set of permitted tools?** **No** (internally). `llmStructured` fills one schema per call (`services.ts:440-459`). The one true *typed tool registry with per-tool validation* is the **MCP server** (`mcp.ts:38-149`), which currently serves external clients only.

3. **Multiple dependent tool calls?** **No.** Longest chains are fixed loops (chunked notes `pipeline.ts:242-258`; speaker matching `428-452`), not model-directed interleaving.

4. **Persist agent state across requests?** **No.** There is durable *processing* state (segment transcript cache, `process_attempts`, `note_versions`, `decision_history`) but no run/step/message/approval state.

5. **Pause for approval and resume?** **Partial.** The pipeline hands off long recordings across time-limit runs (`pipeline.ts:404-421`, 20-attempt cap); human review exists only in the KG (`review_status`) and the task `needs_review` flag (which does not gate execution).

6. **Secure, scoped memory?** **Partial.** KG + decisions are owner-only via RLS, but (a) no cross-run entity resolution, (b) assertions not utterance-cited, (c) `source_refs.verificationStatus` stale, (d) supersession is a similarity heuristic without temporal reasoning, (e) no team/org memory sharing.

7. **Cite individual utterances/timestamps?** **Partial, strong foundation.** Notes-level key points/decisions/tasks carry `quote_ms` via `findQuote` (`verify.ts:97-136`); `describeTask` prints `Said (at m:ss): "…"` (`trackers.ts:300-315`). The **Ask answer** only gets model-authored "(Recording title, m:ss)" text (`prompts.ts:256-260`) — not machine-verified, and sources are recording-level (`ask/index.ts:61`).

8. **Identify conflicting info across meetings?** **Partial/minimal.** Only decision supersession (`decisionLifecycle.ts` + `pipeline.ts:90-116`). No general cross-claim contradiction detection.

9. **Recover from partial failures?** **Partial.** Best-in-class at the recording level (per-chip persist, resumable handoff, `status:'failed'` + notify + failed-hooks, bot duplicate guard); but external writes are **not idempotent** (`trackers.createIssue` has no idempotency key) and there are no compensating actions.

10. **Tool-specific permissions?** **Partial.** Strong RLS + `userClient`/`adminClient` discipline ("service client used only after ownership check", `services.ts:76-88`) and a permission-aware read layer (`mcp_source.ts`). But there is **no agent-level tool scope/allowlist matrix** — permissions are table-level RLS plus ad-hoc checks.

11. **Explain proposed/completed actions?** **Partial.** Automations log `last_result`, webhooks log `last_status`/`last_error`, `push-tasks` returns per-task results. No structured plan→approve→executed narrative.

12. **Bounded time/token/cost?** **Partial.** Low-level bounds exist (`LLM_TIMEOUT_MS`, `STT_TIMEOUT_MS`, `PIPELINE_BUDGET_MS` + handoff cap, `NOTES_MAX_TRANSCRIPT_CHARS`, `LLM_MAX_TOKENS`, `MAX_CONTEXT_CHARS`, image budget, billing minutes). **No agent-level budgets** (max steps, max tool calls, cumulative tokens/cost) because there is no agent runtime.

## 1.9 Distinguishing deterministic automation from agent reasoning

Murmur's existing pipeline and after-ready code are **deterministic workflow automation** with LLM used as a structured transducer (transcript → notes JSON). Nothing reasons over goals or selects among dynamic tool sequences. The agent work is therefore **additive**: introduce goal-directed orchestration and reuse the transducers as tools, without rewriting them.
