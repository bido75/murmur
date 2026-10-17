-- Closing the remaining limits: resumable long recordings, two-channel desktop audio, Procore
-- token renewal lock, highlight reels, RingCentral, bigger uploads.

-- ---------- Long recordings: each part's transcript is kept until the whole one is saved ----------
-- So a run that hits the server's time limit continues where it stopped instead of starting over.

create table public.segment_transcripts (
  recording_id uuid not null references public.recordings (id) on delete cascade,
  idx int not null,
  cache_key text not null,
  utterances jsonb not null,
  duration_ms int not null default 0,
  language text,
  created_at timestamptz not null default now(),
  primary key (recording_id, idx)
);
alter table public.segment_transcripts enable row level security; -- server only (no policies)
revoke all on public.segment_transcripts from anon, authenticated;

alter table public.recordings add column process_attempts int not null default 0;

-- ---------- Desktop: your mic and the other people on separate channels ----------
alter table public.recordings add column channels smallint not null default 1 check (channels in (1, 2));

-- ---------- Procore (and other rotating refresh tokens): one renewal at a time ----------
alter table public.integrations add column refreshing_until timestamptz;

-- Service only. True if the caller may renew now; false if another renewal is in progress.
create or replace function public.claim_token_refresh(uid uuid, prov text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update integrations set refreshing_until = now() + interval '30 seconds'
  where user_id = uid and provider = prov and (refreshing_until is null or refreshing_until < now());
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.claim_token_refresh(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_token_refresh(uuid, text) to service_role;

-- ---------- Highlight reels: clips from several recordings, in order, shareable ----------

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade, -- shared with a team in the app
  title text not null check (length(trim(title)) between 1 and 120),
  share_token text unique,
  created_at timestamptz not null default now()
);
alter table public.playlists enable row level security;
create policy "see own or team reels" on public.playlists for select
  using (user_id = auth.uid() or (workspace_id is not null and public.is_member(workspace_id)));
create policy "make own reels" on public.playlists for insert
  with check (user_id = auth.uid() and (workspace_id is null or public.is_member(workspace_id)));
create policy "change own reels" on public.playlists for update
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (workspace_id is null or public.is_member(workspace_id)));
create policy "delete own reels" on public.playlists for delete using (user_id = auth.uid());
revoke update on public.playlists from authenticated;
grant update (title, workspace_id) on public.playlists to authenticated;

create table public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  recording_id uuid not null references public.recordings (id) on delete cascade,
  start_ms int not null check (start_ms >= 0),
  end_ms int not null,
  title text check (title is null or length(title) <= 200),
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (end_ms > start_ms and end_ms - start_ms <= 600000)
);
create index playlist_items_list on public.playlist_items (playlist_id, position);
alter table public.playlist_items enable row level security;

create or replace function public.owns_playlist(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from playlists where id = pid and user_id = auth.uid())
$$;
create or replace function public.sees_playlist(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from playlists p where p.id = pid and (p.user_id = auth.uid() or (p.workspace_id is not null and public.is_member(p.workspace_id))))
$$;

create policy "see reel clips you can read" on public.playlist_items for select
  using (public.sees_playlist(playlist_id) and public.can_read_recording(recording_id));
create policy "add clips you can read" on public.playlist_items for insert
  with check (public.owns_playlist(playlist_id) and public.can_read_recording(recording_id));
create policy "change own reel clips" on public.playlist_items for update
  using (public.owns_playlist(playlist_id)) with check (public.owns_playlist(playlist_id) and public.can_read_recording(recording_id));
create policy "remove own reel clips" on public.playlist_items for delete using (public.owns_playlist(playlist_id));

-- Turn a public link on (returns the token) or off (returns null).
create or replace function public.set_playlist_sharing(pid uuid, enabled boolean)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if not exists (select 1 from playlists where id = pid and user_id = auth.uid()) then raise exception 'Only the reel''s creator can share it'; end if;
  if enabled then
    tok := translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');
    update playlists set share_token = coalesce(share_token, tok) where id = pid returning share_token into tok;
    perform audit(null, 'reel.shared', 'playlist', pid::text, '{}'::jsonb, auth.uid());
    return tok;
  end if;
  update playlists set share_token = null where id = pid;
  return null;
end $$;
revoke execute on function public.set_playlist_sharing(uuid, boolean) from anon;

-- Service only: which clips of a public reel may be shown. Only recordings the reel's creator
-- made, not deleted, and not in a team whose policy turns public links off.
create or replace function public.public_reel_items(tok text)
returns table (title text, playlist_title text, recording_id uuid, recording_title text, created_at timestamptz, start_ms int, end_ms int, audio_deleted boolean)
language sql stable security definer set search_path = public as $$
  select i.title, p.title, r.id, r.title, r.created_at, i.start_ms, i.end_ms, r.audio_deleted_at is not null
  from playlists p
  join playlist_items i on i.playlist_id = p.id
  join recordings r on r.id = i.recording_id and r.user_id = p.user_id and r.status = 'ready'
  left join projects pr on pr.id = r.project_id
  left join workspace_policies wp on wp.workspace_id = pr.workspace_id
  where p.share_token = tok and coalesce(wp.allow_public_links, true)
  order by i.position, i.created_at
$$;
revoke execute on function public.public_reel_items(text) from public, anon, authenticated;
grant execute on function public.public_reel_items(text) to service_role;

-- ---------- RingCentral ----------
alter table public.integrations drop constraint integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check check (provider in (
  'asana', 'linear', 'jira', 'procore', 'monday', 'clickup', 'trello',
  'hubspot', 'salesforce', 'slack', 'notion', 'google_docs', 'onenote', 'aircall', 'ringcentral'
));
alter table public.integration_oauth_states drop constraint integration_oauth_states_provider_check;
alter table public.integration_oauth_states add constraint integration_oauth_states_provider_check
  check (provider in ('procore', 'slack', 'salesforce', 'google_docs', 'onenote', 'ringcentral'));
alter table public.inbound_hooks drop constraint inbound_hooks_provider_check;
alter table public.inbound_hooks add constraint inbound_hooks_provider_check check (provider in ('aircall', 'ringcentral'));
alter table public.recordings drop constraint recordings_source_check;
alter table public.recordings add constraint recordings_source_check
  check (source in ('mic', 'import', 'link', 'bot', 'phone', 'aircall', 'ringcentral', 'extension', 'watch', 'screen'));

-- ---------- Bigger files ----------
-- Imports and screen recordings can be large; allow up to 5 GB per file in the audio bucket
-- (the project-wide limit in Storage settings must be at least this).
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 5368709120 where id = 'audio';
  end if;
end $$;

-- ---------- AI tools and the REST API reach every readable recording, not just the newest 1,000 ----------

create or replace function public.readable_recording_page(uid uuid, pid uuid default null, since timestamptz default null, before timestamptz default null, max_rows int default 25)
returns table (id uuid, user_id uuid, project_id uuid, title text, created_at timestamptz, status text, duration_ms int)
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, r.project_id, r.title, r.created_at, r.status, r.duration_ms
  from recordings r
  where (r.user_id = uid or (r.project_id is not null and public.can_read_project(r.project_id, uid)))
    and (pid is null or r.project_id = pid)
    and (since is null or r.created_at >= since)
    and (before is null or r.created_at < before)
  order by r.created_at desc
  limit least(greatest(max_rows, 1), 200)
$$;

create or replace function public.search_recordings_for(uid uuid, q text, max_results int default 10)
returns table (recording_id uuid, title text, created_at timestamptz, project_id uuid, status text, duration_ms int, snippet text, at_ms int)
language sql stable security definer set search_path = public as $$
  with qq as (
    select websearch_to_tsquery('simple', q) as tsq,
           '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select r.id, r.title, r.created_at, r.project_id, r.status, r.duration_ms,
    case when t.search @@ qq.tsq then ts_headline('simple', t.text, qq.tsq, 'MaxWords=40, MinWords=15, StartSel=, StopSel=, MaxFragments=1')
         when s.overview ilike qq.pat then left(s.overview, 300) end,
    case when t.search @@ qq.tsq then (
      select (u ->> 'start_ms')::int from jsonb_array_elements(t.utterances) u
      where to_tsvector('simple', coalesce(u ->> 'text', '')) @@ qq.tsq order by (u ->> 'start_ms')::int limit 1) end
  from recordings r cross join qq
  left join transcripts t on t.recording_id = r.id
  left join summaries s on s.recording_id = r.id
  where length(trim(q)) >= 2
    and (r.user_id = uid or (r.project_id is not null and public.can_read_project(r.project_id, uid)))
    and (t.search @@ qq.tsq or r.title ilike qq.pat or s.overview ilike qq.pat)
  order by (coalesce(ts_rank(t.search, qq.tsq), 0) + case when r.title ilike qq.pat then 1 else 0 end) desc, r.created_at desc
  limit least(greatest(max_results, 1), 50)
$$;

create or replace function public.readable_tasks(uid uuid, task_status text, pid uuid default null, max_rows int default 50)
returns table (id uuid, text text, owner text, due_text text, status text, needs_review boolean, recording_id uuid, recording text, quote text)
language sql stable security definer set search_path = public as $$
  select t.id, t.text, t.owner, t.due_text, t.status, t.needs_review, t.recording_id, r.title, t.quote
  from tasks t join recordings r on r.id = t.recording_id
  where (r.user_id = uid or (r.project_id is not null and public.can_read_project(r.project_id, uid)))
    and (pid is null or r.project_id = pid)
    and case task_status
          when 'open' then t.status = 'open' and not t.needs_review
          when 'review' then t.status = 'open' and t.needs_review
          when 'done' then t.status = 'done'
          else false end
  order by t.created_at desc
  limit least(greatest(max_rows, 1), 200)
$$;

revoke execute on function public.readable_recording_page(uuid, uuid, timestamptz, timestamptz, int), public.search_recordings_for(uuid, text, int), public.readable_tasks(uuid, text, uuid, int) from public, anon, authenticated;
grant execute on function public.readable_recording_page(uuid, uuid, timestamptz, timestamptz, int), public.search_recordings_for(uuid, text, int), public.readable_tasks(uuid, text, uuid, int) to service_role;
