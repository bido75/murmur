# 8. Performance and Cost Model

Murmur has user-reported mobile responsiveness issues — the agent must not add workload to the recording UI thread and must not degrade recording reliability. Backend-only orchestration is mandated.

## 8.1 Budgets (per run)

| Limit | Default (proposed) | Reuses |
|---|---|---|
| Max planning steps | 8 | new `budgets.ts` |
| Max tool calls | 16 | new `budgets.ts` |
| Max total wall-clock | 60 s (short) / background queue for long runs | `llmTimeoutMs` (300 s), `PIPELINE_BUDGET_MS` (240 s) |
| Max cumulative LLM tokens | configurable (e.g. 200k) | `LLM_MAX_TOKENS` (12k/call) |
| Max external (write) actions | 4 per run, all approval-gated | idempotency keys |
| Per-user rate limit | e.g. 10 runs/min | new (none today) |
| Estimated cost | cap via `LLM_PROVIDER` selection by task complexity | `entitlements.ts` minutes |

Rationale: `llmStructured` is single-call today, so the main new cost is the *loop* — read-only retrieval steps are cheap (DB), the LLM is called only for intent/plan/grounding, and mutations are gated and human-paced.

## 8.2 Cost drivers and model of the canonical request

"Review three meetings + draft follow-up" ≈ 1 intent call + 1 plan call + ~6 read-only tool calls (DB/retrieval, no LLM) + 1 draft call + 1 grounding/verify call. Approx 4 LLM calls; any `followups.send` is human-triggered and one request.

- Model selection by complexity: use the cheapest configured provider (`ollama` local → `openrouter :free` text → paid) for intent/plan; reserve the larger model for drafting; reuse `llmProvider()` (`services.ts:327-334`).

## 8.3 Latency and the mobile constraint

- Orchestration runs in the Edge Function, off the device (same as today's `ask`/`make-deck`).
- Live meeting assistance is **debounced and incremental** — no LLM per transcript token; the existing `live/` path only issues a Deepgram token (no LLM), and any "during-meeting" agent observes *finalized* segments.
- Retrieval is paged/incremental; context is reference-based and window-budgeted (`NOTES_MAX_TRANSCRIPT_CHARS`/`MAX_CONTEXT_CHARS` patterns reuse).

## 8.4 Benchmark plan (before/after agent integration)

Measure and record deltas:
- Agent response latency (p50/p95), tool execution time, DB query latency.
- Token consumption and cost per completed task (free-text-only vs draft vs deck-with-images).
- Failure and retry rates; approval expiry/replay rates.
- Mobile: recording reliability and memory unchanged (agent runs server-side); regression suite J in `01-capability-audit`.

## 8.5 Explicit non-goals

- No long-running background loops inside a single request (resume via `agent_runs` + `/resume`).
- No new billable infrastructure: reuse existing Supabase functions/Postgres; image generation remains opt-in and budget-capped (`make-deck` `DEFAULT_IMAGE_BUDGET`).
