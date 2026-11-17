-- Agent Core: durable run/step/message/approval state for the native agent runtime.
-- Additive, user-scoped, RLS owner-only (team/org sharing is a follow-up). The agent
-- runs under the caller's identity (service_role is used only for the same uid-scoped
-- readable_* functions the MCP server already uses). See docs/agent-core-audit/05.

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
  status text not null default 'planning' check (status in ('planning','running','awaiting_approval','completed','failed','cancelled')),
  plan jsonb not null default '[]'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  step_index int not null,
  tool text not null,
  status text not null default 'pending' check (status in ('pending','running','awaiting_approval','succeeded','failed','skipped')),
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
  args_sha256 text not null,
  result jsonb,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','denied')),
  idempotency_key text,
  created_at timestamptz not null default now()
);

create table public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  tool_call_id uuid not null references public.agent_tool_calls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  action_hash text not null,
  destination text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agent_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
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

create index agent_runs_user_created on public.agent_runs (user_id, created_at desc);
create index agent_steps_run_index on public.agent_steps (run_id, step_index);
create index agent_approvals_user_status on public.agent_approvals (user_id, status);

-- Row-level security: runs, messages, steps, approvals and artifacts are owner-only.
alter table public.agent_sessions enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_steps enable row level security;
alter table public.agent_tool_calls enable row level security;
alter table public.agent_approvals enable row level security;
alter table public.agent_artifacts enable row level security;
alter table public.agent_memory_refs enable row level security;

create policy "own sessions" on public.agent_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own runs" on public.agent_runs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own messages" on public.agent_messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own steps" on public.agent_steps for all using (exists (select 1 from public.agent_runs r where r.id = run_id and r.user_id = auth.uid()));
create policy "own tool calls" on public.agent_tool_calls for all using (exists (select 1 from public.agent_steps s join public.agent_runs r on r.id = s.run_id where s.id = step_id and r.user_id = auth.uid()));
create policy "own approvals" on public.agent_approvals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own artifacts" on public.agent_artifacts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own memory refs" on public.agent_memory_refs for all using (exists (select 1 from public.agent_runs r where r.id = run_id and r.user_id = auth.uid()));

-- Rollback:
--   drop policy if exists "own memory refs" on public.agent_memory_refs;
--   drop policy if exists "own artifacts" on public.agent_artifacts;
--   drop policy if exists "own approvals" on public.agent_approvals;
--   drop policy if exists "own tool calls" on public.agent_tool_calls;
--   drop policy if exists "own steps" on public.agent_steps;
--   drop policy if exists "own messages" on public.agent_messages;
--   drop policy if exists "own runs" on public.agent_runs;
--   drop policy if exists "own sessions" on public.agent_sessions;
--   drop table if exists public.agent_memory_refs, public.agent_artifacts, public.agent_approvals,
--     public.agent_tool_calls, public.agent_steps, public.agent_messages, public.agent_runs, public.agent_sessions;
