-- Knowledge Graph: a relational model in Postgres (no separate graph database).
-- Entities are named nodes; assertions are provenance-carrying edges/facts; decision
-- history tracks a decision's lifecycle across meetings. Additive and user-scoped.

create table public.knowledge_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('person','organization','project','topic','product','location','event','risk','other')),
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

create table public.knowledge_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.knowledge_entities (id) on delete cascade,
  alias text not null,
  unique (entity_id, alias)
);

create table public.knowledge_assertions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references public.knowledge_entities (id) on delete cascade,
  predicate text not null,
  object_id uuid references public.knowledge_entities (id) on delete set null,
  value text,
  source_refs jsonb not null default '[]'::jsonb, -- [{ recordingId, utteranceIds, startMs, endMs, excerpt, verificationStatus }]
  confidence real not null default 0 check (confidence >= 0 and confidence <= 1),
  review_status text not null default 'proposed' check (review_status in ('proposed','verified','rejected')),
  created_at timestamptz not null default now()
);
create index knowledge_assertions_subject on public.knowledge_assertions (subject_id);
create index knowledge_assertions_user on public.knowledge_assertions (user_id, review_status);

create table public.decision_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recording_id uuid references public.recordings (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  text text not null,
  status text not null default 'accepted' check (status in ('proposed','accepted','revised','superseded','rejected')),
  supersedes_id uuid references public.decision_history (id) on delete set null,
  created_at timestamptz not null default now()
);
create index decision_history_project on public.decision_history (project_id, created_at desc);

-- Row-level security: personal knowledge, owner-only for now (team/org sharing is a
-- follow-up that would add can_read_recording-style policies).
alter table public.knowledge_entities enable row level security;
alter table public.knowledge_aliases enable row level security;
alter table public.knowledge_assertions enable row level security;
alter table public.decision_history enable row level security;

create policy "own entities" on public.knowledge_entities for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own aliases" on public.knowledge_aliases for all using (exists (select 1 from public.knowledge_entities e where e.id = entity_id and e.user_id = auth.uid()));
create policy "own assertions" on public.knowledge_assertions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own decisions" on public.decision_history for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Rollback:
--   drop policy if exists "own entities" on public.knowledge_entities;
--   drop policy if exists "own aliases" on public.knowledge_aliases;
--   drop policy if exists "own assertions" on public.knowledge_assertions;
--   drop policy if exists "own decisions" on public.decision_history;
--   drop table if exists public.decision_history, public.knowledge_assertions, public.knowledge_aliases, public.knowledge_entities;
