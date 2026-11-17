# 5. Database Migration Proposal (additive, with RLS)

This is a **proposal**, not an applied migration. Per `PROJECT_RULES.md` rule 3, it will be a *new* timestamped SQL file with RLS + a `supabase/tests/*.test.mjs` proving outsider/teammate isolation. `knowledge_graph` (`20261109010000_knowledge_graph.sql`) is the closest existing precedent for style and RLS.

## 5.1 Proposed tables

```sql
-- agent_sessions: durable conversation grouping (optional top level)
create table public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.agent_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  intent text not null default 'general',
  status text not null default 'planning'
    check (status in ('planning','running','awaiting_approval','completed','failed','cancelled')),
  plan jsonb not null default '[]'::jsonb,          -- proposed steps (validated)
  idempotency_key text,                             -- client-supplied or derived
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,                            -- bounded; NOT transcript dumps
  created_at timestamptz not null default now()
);

create table public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  step_index int not null,
  tool text not null,
  status text not null default 'pending'
    check (status in ('pending','running','awaiting_approval','succeeded','failed','skipped')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (run_id, step_index)
);

create table public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.agent_steps (id) on delete cascade,
  tool text not null,
  args jsonb not null,
  args_sha256 text not null,                        -- approval binding + replay guard
  result jsonb,
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed','denied')),
  idempotency_key text,
  created_at timestamptz not null default now()
);

create table public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  tool_call_id uuid not null references public.agent_tool_calls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  action_hash text not null,                        -- sha256(tool + args)
  destination text,                                 -- e.g. email/slack/CRM target
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agent_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,                               -- followup_draft, deck, doc, etc.
  storage_path text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table public.agent_memory_refs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  entity_id uuid references public.knowledge_entities (id) on delete set null,
  recording_id uuid references public.recordings (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  assertion_id uuid references public.knowledge_assertions (id) on delete set null,
  created_at timestamptz not null default now()
);
```

## 5.2 RLS (every table, per PROJECT_RULES rule 3)

```sql
alter table public.agent_sessions enable row level security;
-- …and the same for each table above.

create policy "own sessions"  on public.agent_sessions  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- repeat for agent_runs, agent_messages, agent_steps, agent_tool_calls,
--   agent_approvals, agent_artifacts, agent_memory_refs
```

Indexes: `agent_runs(user_id, created_at desc)`, `agent_steps(run_id, step_index)`, `agent_approvals(user_id, status)`.

## 5.3 Design invariants

1. **No service-role for the agent.** The agent's edge function uses `userClient` (RLS) for reads like `mcp_source.ts`, and only uses `adminClient` for white-listed background writes *after* an ownership check (`services.ts:76`).
2. **Stable references, not blob copies** — `agent_memory_refs` links; `agent_messages.content` is bounded; `artifacts` stores generated outputs, not transcripts.
3. **Approval binding** — `agent_approvals.action_hash = sha256(tool + canonical args)`; a changed-args repetition produces a new hash and therefore cannot reuse the old approval. `expires_at` prevents stale approval.
4. **Idempotency** — `agent_tool_calls.idempotency_key` and `agent_runs.idempotency_key` prevent duplicate side effects on retry/recovery; adopt the same field on the underlying mutation writers (`trackers.createIssue`, `destinations.*`) before exposing them (see `03-tool-registry-inventory.md §3.5`).
5. **Retention/cascade** — `on delete cascade` from user/runs; derived knowledge references cascade on source deletion.

## 5.4 Migration/test plan

- Single new file `supabase/migrations/YYYYMMDDHHMMSS_agent_core.sql` (timestamp after `20261109010000_knowledge_graph.sql`).
- New `supabase/tests/agent-core.test.mjs` using `harness.mjs`: owner can insert/read all tables; outsider reads/writes 0 rows; teammate cross-tenant isolation is blocked (mirror `knowledge.test.mjs`).
