-- Note versions: preserve a snapshot of a recording's summary before it is
-- regenerated, so a user can compare and restore prior notes. Additive only.

create table public.note_versions (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null,
  summary jsonb not null,
  detail_level text not null default 'detailed',
  reason text not null default 'generate',   -- 'generate' | 'regenerate'
  created_at timestamptz not null default now()
);

create unique index note_versions_recording_version on public.note_versions (recording_id, version);
create index note_versions_recording on public.note_versions (recording_id, version desc);

alter table public.note_versions enable row level security;

-- Owner manages their own versions; teammates can read them alongside the summary.
create policy "own note versions" on public.note_versions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "read note versions" on public.note_versions
  for select using (public.can_read_recording(recording_id));

-- Rollback:
--   drop policy if exists "read note versions" on public.note_versions;
--   drop policy if exists "own note versions" on public.note_versions;
--   drop table if exists public.note_versions;
