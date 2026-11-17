# Phase 5 — Cross-Meeting AI & Knowledge Graph

Status: **foundation in place (relational KG schema + RLS); extraction/retrieval/UI remain.**

## 8.1 Existing infrastructure (audited)

- Retrieval/ask: `ask/`, `mcp/`, `_shared/recall.ts`, `_shared/semantic.ts`.
- Semantic topic trackers: `_shared/trackers.ts`.
- Search: `search_transcripts` + `search_recordings` SQL functions (RLS-scoped).

These cover keyword + semantic retrieval over transcripts and tasks. What was **missing** is a durable, cross-meeting graph of entities/relations/assertions and a decision lifecycle.

## 8.3/8.8 Knowledge Graph model (added, relational — no graph DB)

`20261109010000_knowledge_graph.sql` (additive, user-scoped, RLS):

- `knowledge_entities` — named nodes (`person|organization|project|topic|product|location|event|risk|other`), deduped by `(user_id, kind, name)`.
- `knowledge_aliases` — alternative spellings for an entity (resolution aid).
- `knowledge_assertions` — subject→predicate→object/value, with `source_refs` (provenance), `confidence` (0–1), `review_status` (`proposed|verified|rejected`).
- `decision_history` — `proposed|accepted|revised|superseded|rejected` + `supersedes_id` chain + `recording_id`/`project_id`.

RLS: owner-only (personal knowledge); team/org sharing is a deliberate follow-up. Tested in `supabase/tests/knowledge.test.mjs` (owner read/write, outsider blocked).

## Gap matrix (8.2–8.10)

| Capability | Status |
|---|---|
| Relational KG schema | ✅ this phase |
| RLS isolation | ✅ tested |
| Knowledge extraction (8.4) | ❌ next (LLM entity/relation extraction from verified notes) |
| Decision lifecycle population | ❌ next (write `decision_history` from verified decisions) |
| Cross-recording retrieval hardening (8.2) | ⚠️ partial (ask/mcp/recall exist; no query decomposition/reranking) |
| KG UI (8.7) | ❌ |
| API contracts (8.9) | ❌ |
| Benchmarks / permission isolation (8.10) | ⚠️ RLS tested; retrieval quality unmeasured |

## Remaining (explicit)

1. Extraction job: LLM proposes entities/relations/assertions from `detailed_sections` + `decisions`, with human review.
2. Decision lifecycle: write `decision_history` (with `supersedes_id`) when a decision changes across meetings.
3. Retrieval: query decomposition + source reranking + timestamp-linked answers (build on `ask/`).
4. KG UI: project intelligence, decision timeline, evidence panel.

## Note

Per the spec, this uses the existing Postgres schema — no Neo4j/vector DB was introduced.
