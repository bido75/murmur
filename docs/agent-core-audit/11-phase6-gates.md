# 11. Phase 6 — Evaluation, Security, Performance and Release Gates

Consolidation of the implemented agent core (`feature/murmur-desktop-v2`, commits `16df1cf`…`70fccee`) against the directive's acceptance and security criteria. This is the read-only gate that decides go-live; it does not deploy, merge, or migrate.

## 11.1 Regression results (run this turn)

| Gate | Result |
|---|---|
| `npm test` — logic | 315 / 315 pass |
| `npm test` — app | 66 / 66 pass |
| `npm test` — database security | 104 / 104 pass |
| `npx tsc --noEmit` (app) | exit 0 |
| `deno check functions/{agent,knowledge,mcp}/index.ts` | pass |

**Known environment limitation (not a code defect):** `deno check supabase/functions/*/index.ts` over *all* functions cannot complete here because `npm:docx@9` is absent from the local Deno npm cache; functions importing `_shared/docx.ts` (`export`, `process-recording`, `make-deck`) fail *resolution*, not type-checking. Those functions are unchanged by this work; a clean CI/Deno cache resolves them.

## 11.2 Phase 10 acceptance scenarios

| # | Scenario | Status | Evidence / gap |
|---|---|---|---|
| A | Cross-meeting research with timestamp citations | **Partial** | Read tools + `utteranceCitations`/`sourceRef` + `knowledge.decision_history` exist; **semantic hybrid search deferred**; the Ask endpoint is not yet driven by the agent runtime. |
| B | Meeting preparation | **Partial** | `brief/index.ts` (pre-existing) + `meetingBriefMaterial` + read tools; no front-end wiring. |
| C | Follow-up draft + approval before send | **Partial** | `followups.send` approval-gated + `recapEmail` reuse; draft-as-artifact not surfaced; external send live-unverified. |
| D | Task creation from verified commitments | **Implemented** | `tasks.create` approval-gated, quote-grounded (`buildTaskInput`); RLS + orchestrator tested. |
| E | Conflicting / superseded decisions, chronological | **Implemented** | `decision_history` + `supersedesPrior` + `knowledge.decision_history`; tested. |
| F | Document generation | **Not started** (Phase 5) | `make-deck` exists; not wrapped as agent tools. |
| G | Prompt injection cannot trigger actions | **Implemented by design** | Registry allowlist (`validatePlan` rejects unknown tools); transcript treated as data; no tool runs from model text. |
| H | Cross-tenant isolation | **Implemented** | `readable_*` + `can_read_recording` uid-scoping; owner-only agent tables; `agent-core` + `knowledge` RLS tests. |
| I | Partial failure without duplicate side effects | **Partial** | Single-use approvals + idempotent replay + per-step outcomes; provider-level idempotency keys deferred. |
| J | Recording performance unaffected | **Not measured** | Agent runs backend-only by design; no benchmark. |

## 11.3 Security threat model coverage

| Threat | Mitigation | Covered by |
|---|---|---|
| T1 prompt injection | Allowlist + data≠instruction | `validatePlan` unknown-tool test |
| T2 unauthorized tool | `riskLevel` + `policyFor` + approval | registry tests |
| T3 cross-tenant | RLS + uid-scoped Source | `agent-core`, `knowledge` db tests |
| T4 approval replay | `action_hash` + single-use + expiry | `agent_approvals` tests + endpoint rechecks |
| T5 SSRF | existing `isPrivateHost`; no new fetch-by-model | unchanged |
| T6 duplicate side effects | single-use approval + replay dedupe + `external[provider].url` | `agent_resume` tests |
| T7 credential exposure | env-only credentials, output-bounded | unchanged |
| T8 unbounded execution | `budgets` (maxSteps/maxToolCalls) + timeouts | `agent_budgets` tests |
| T9 data minimization | reference-based context, paged transcripts | `Source` paging |
| T10 audit trail | `agent_runs/steps/tool_calls/approvals` | RLS tests |

## 11.4 Performance & cost (status)

- Bounded loop (max steps / max tool calls), provider timeouts, context caps, and billing-minute gating are in place (`agent_budgets`, `services`, `entitlements`).
- **Not benchmarked** (no live stack); no per-user rate limiter yet; no token/cost meter on agent runs.

## 11.5 Go / No-Go (updated)

**NO-GO for production deployment today.** Everything is on the feature branch, unit/RLS-tested, but:

- nothing is deployed or migrated (the `agent_core` migration is a file only);
- no front-end (Phase 7) and the Ask endpoint is not yet agent-driven;
- external actions (`followups.send`, `integrations.export`) are typechecked but never run against live providers (rule 10);
- semantic embeddings, rate limiting, `calendar.create_event`, and derived-data deletion are outstanding;
- multi-approval `resume` is typechecked but not exercised end-to-end on the edge runtime.

**GO (continued engineering)** toward Phase 5/6 completion. A production gate additionally requires: Phase 10 A–J integration tests on a live sandbox, a per-user rate limiter + cost meter, a feature-flag rollout (`ROADMAP.md` M2), and operator sign-off.

## 11.6 Phase 10 scenario → test coverage (backend)

The machine-testable acceptance scenarios are covered by the following suites; the rest (`F` deck/docx, `J` recording performance) require the live stack and are deferred to the A–J run:

| Scenario | Covered by |
|---|---|
| D — task creation, quote-grounded | `agent_actions.test.ts` + `agent_registry.test.ts` |
| E — decision supersession | `decisionLifecycle.test.ts` |
| G — prompt injection (no unknown tool executes) | `agent_planner.test.ts` + `agent_orchestrator.test.ts` |
| H — cross-tenant isolation | `agent-core.test.mjs` + `knowledge.test.mjs` |
| I — partial failure, no auto-executed mutation | `agent_orchestrator.test.ts` |
| A — citations | `agent_retrieval.test.ts` |
| B — meeting brief | `agent_meeting.test.ts` |
| C — approval binding / no replay | `agent_approvals.test.ts` |
| Per-user rate limit | `agent_rate_limit.test.ts` |
| Token budget | `agent_cost.test.ts` |
