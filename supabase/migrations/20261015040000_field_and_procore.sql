-- Field mode and Procore.
-- - Photos taken during a recording, pinned to the moment they were taken.
-- - A daily site log written from site-walk recordings (stored with the notes).
-- - Per-project words to listen for (names, trades, product terms) for better transcripts.
-- - Procore connection (OAuth) for punch items and daily log notes.

-- A text-to-uuid cast that returns null instead of failing, for use in storage policies
-- where the folder name is user-supplied.
create or replace function public.try_uuid(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- ---------- Photos ----------

create table public.recording_photos (
  id uuid primary key,                         -- generated on the phone, so retries don't duplicate
  recording_id uuid not null references public.recordings (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null,                  -- photos/<user_id>/<recording_id>/<id>.jpg
  taken_ms integer check (taken_ms is null or taken_ms >= 0),  -- position in the recording; null = added afterwards
  caption text check (caption is null or length(caption) <= 500),
  width integer,
  height integer,
  created_at timestamptz not null default now()
);
create index recording_photos_recording on public.recording_photos (recording_id, taken_ms);
alter table public.recording_photos enable row level security;

create policy "read photos" on public.recording_photos for select
  using (public.can_read_recording(recording_id));
-- Only the person who made the recording adds photos to it, into their own folder.
create policy "owner adds photos" on public.recording_photos for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.recordings r where r.id = recording_id and r.user_id = auth.uid())
  and storage_path like auth.uid()::text || '/' || recording_id::text || '/%'
);
create policy "owner edits photos" on public.recording_photos for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner deletes photos" on public.recording_photos for delete using (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy "read photos files" on storage.objects for select using (
  bucket_id = 'photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.can_read_recording(public.try_uuid((storage.foldername(name))[2]))
  )
);
create policy "write own photos files" on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own photos files" on storage.objects for update
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own photos files" on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Tasks found while a photo was being taken carry it (and send it to Procore with the item).
alter table public.tasks add column photo_ids uuid[] not null default '{}';

-- ---------- Site log ----------

alter table public.summaries add column site_log jsonb;
-- Where the log was sent (e.g. {"procore": {"id": "…", "url": "…"}}), so it isn't sent twice.
alter table public.summaries add column site_log_external jsonb;

-- ---------- Words to listen for ----------

alter table public.projects add column vocabulary text[] not null default '{}'
  check (cardinality(vocabulary) <= 100);

-- ---------- Procore ----------

alter table public.integrations drop constraint integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check
  check (provider in ('asana', 'linear', 'jira', 'procore'));
-- OAuth providers keep a short-lived access token next to the refresh token (in `secret`).
-- Neither column is granted to the app (see the column grants on this table).
alter table public.integrations add column access_secret text;
alter table public.integrations add column access_expires_at timestamptz;

create table public.integration_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('procore')),
  return_to text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.integration_oauth_states enable row level security;
revoke all on public.integration_oauth_states from anon, authenticated;
