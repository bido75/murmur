-- Murmur MVP schema.
-- Every table is private to its owner via row-level security (user_id = auth.uid()).

create extension if not exists pgcrypto;

-- A recording session. Audio arrives as one or more segments (the app rotates
-- files every few minutes so a crash can never lose more than one segment).
create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'New recording',
  template text not null default 'general'
    check (template in ('general', 'meeting', 'lecture', 'phone_call', 'site_walk', 'sales_call', 'interview')),
  source text not null default 'mic' check (source in ('mic', 'import')),
  status text not null default 'recording'
    check (status in ('recording', 'uploading', 'transcribing', 'summarizing', 'ready', 'failed')),
  duration_ms integer not null default 0,
  language text,
  consent_confirmed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recordings_user_created on public.recordings (user_id, created_at desc);

create table public.recording_segments (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  idx integer not null,
  storage_path text not null,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now(),
  unique (recording_id, idx)
);

-- Utterances: [{ start_ms, end_ms, speaker, text }]
create table public.transcripts (
  recording_id uuid primary key references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  utterances jsonb not null default '[]'::jsonb,
  text text not null default '',
  search tsvector generated always as (to_tsvector('simple', coalesce(text, ''))) stored,
  speaker_names jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index transcripts_search on public.transcripts using gin (search);

create table public.summaries (
  recording_id uuid primary key references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  overview text not null default '',
  key_points jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,      -- [{ text, quote, quote_ms, verified }]
  open_questions jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now()
);

-- Action items. Each one carries the transcript quote it came from.
-- verified = the quote was found in the transcript.
-- needs_review = the AI was unsure (unverified quote, unclear owner, or only a suggestion).
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid references public.recordings (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null,
  owner text,
  owner_basis text not null default 'unassigned' check (owner_basis in ('named', 'self_assigned', 'unassigned')),
  due_text text,
  due_date date,
  kind text not null default 'commitment' check (kind in ('commitment', 'suggestion')),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  quote text,
  quote_ms integer,
  verified boolean not null default false,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_user_status on public.tasks (user_id, status, created_at desc);

-- updated_at bookkeeping
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger recordings_touch before update on public.recordings
  for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- Row-level security: owners only.
alter table public.recordings enable row level security;
alter table public.recording_segments enable row level security;
alter table public.transcripts enable row level security;
alter table public.summaries enable row level security;
alter table public.tasks enable row level security;

create policy "own recordings" on public.recordings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own segments" on public.recording_segments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own transcripts" on public.transcripts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own summaries" on public.summaries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own tasks" on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Full-text search across a user's transcripts, used by "Ask across all recordings".
create or replace function public.search_transcripts(q text, max_results int default 8)
returns table (recording_id uuid, rank real)
language sql stable security invoker as $$
  select t.recording_id, ts_rank(t.search, websearch_to_tsquery('simple', q)) as rank
  from public.transcripts t
  where t.user_id = auth.uid() and t.search @@ websearch_to_tsquery('simple', q)
  order by rank desc
  limit max_results
$$;

-- Private audio bucket. Files live at audio/<user_id>/<recording_id>/seg-0001.m4a
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

create policy "own audio read" on storage.objects for select
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio write" on storage.objects for insert
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio update" on storage.objects for update
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own audio delete" on storage.objects for delete
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
