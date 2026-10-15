-- Search, share links, email recaps, custom templates, link imports, retention, account
-- deletion support, attendee consent links, and the optional meeting bot.

-- ---------- Recordings: new sources, statuses and consent method ----------

alter table public.recordings drop constraint recordings_source_check;
alter table public.recordings add constraint recordings_source_check check (source in ('mic', 'import', 'link', 'bot'));
alter table public.recordings drop constraint recordings_status_check;
alter table public.recordings add constraint recordings_status_check
  check (status in ('scheduled', 'recording', 'uploading', 'transcribing', 'summarizing', 'ready', 'failed', 'cancelled'));
alter table public.recordings drop constraint recordings_consent_method_check;
alter table public.recordings add constraint recordings_consent_method_check
  check (consent_method in ('told_everyone', 'in_invite', 'solo', 'consent_link', 'bot_announced', 'not_confirmed'));
-- Set when retention removed the audio (the transcript and notes may remain).
alter table public.recordings add column audio_deleted_at timestamptz;

-- A segment is either a file we store, or a link we were given (imports from a URL).
alter table public.recording_segments alter column storage_path drop not null;
alter table public.recording_segments add column source_url text
  check (source_url is null or (source_url ~ '^https://' and length(source_url) <= 2000));
alter table public.recording_segments add constraint segment_has_audio check (storage_path is not null or source_url is not null);

-- ---------- Search ----------

-- Recordings the caller can read whose title, notes or transcript match. Runs as the
-- caller, so row-level security decides what is visible.
create or replace function public.search_recordings(q text, max_results int default 30)
returns table (recording_id uuid, title text, created_at timestamptz, project_id uuid, template text, snippet text, matched text, rank real)
language sql stable security invoker set search_path = public as $$
  with qq as (
    select websearch_to_tsquery('simple', q) as tsq,
           '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select r.id, r.title, r.created_at, r.project_id, r.template,
    case
      when t.search @@ qq.tsq then ts_headline('simple', t.text, qq.tsq, 'MaxWords=26, MinWords=10, StartSel=[[, StopSel=]], MaxFragments=1')
      when s.overview ilike qq.pat then left(s.overview, 240)
      else null
    end,
    case when t.search @@ qq.tsq then 'transcript' when r.title ilike qq.pat then 'title' else 'notes' end,
    (coalesce(ts_rank(t.search, qq.tsq), 0) + case when r.title ilike qq.pat then 1 else 0 end)::real
  from public.recordings r
  cross join qq
  left join public.transcripts t on t.recording_id = r.id
  left join public.summaries s on s.recording_id = r.id
  where length(trim(q)) >= 2
    and (t.search @@ qq.tsq or r.title ilike qq.pat or s.overview ilike qq.pat)
  order by 8 desc, r.created_at desc
  limit least(greatest(max_results, 1), 50)
$$;
revoke execute on function public.search_recordings(text, int) from anon;

-- ---------- Share links ----------

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  recording_id uuid not null references public.recordings (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  include_transcript boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  views integer not null default 0,
  last_viewed_at timestamptz
);
create index share_links_recording on public.share_links (recording_id);
alter table public.share_links enable row level security;
-- Only the person who made the recording can see, create or revoke its links.
create policy "owner reads share links" on public.share_links for select
  using (exists (select 1 from public.recordings r where r.id = recording_id and r.user_id = auth.uid()));
create policy "owner revokes share links" on public.share_links for update
  using (exists (select 1 from public.recordings r where r.id = recording_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.recordings r where r.id = recording_id and r.user_id = auth.uid()));
revoke all on public.share_links from anon, authenticated;
grant select on public.share_links to authenticated;
grant update (revoked_at) on public.share_links to authenticated;

create or replace function public.create_share_link(rec uuid, with_transcript boolean default false, valid_days int default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from recordings r where r.id = rec and r.user_id = auth.uid()) then
    raise exception 'Only the person who made this recording can share it';
  end if;
  if (select count(*) from share_links where recording_id = rec and revoked_at is null) >= 10 then
    raise exception 'This recording already has 10 active links. Turn one off first.';
  end if;
  tok := translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into share_links (token, recording_id, created_by, include_transcript, expires_at)
    values (tok, rec, auth.uid(), coalesce(with_transcript, false),
            case when valid_days is null then null else now() + make_interval(days => least(greatest(valid_days, 1), 365)) end);
  return tok;
end $$;
revoke execute on function public.create_share_link(uuid, boolean, int) from anon;

-- ---------- Email recaps ----------

create table public.recap_emails (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id) on delete cascade,
  sent_by uuid not null references auth.users (id) on delete cascade,
  recipients text[] not null,
  provider_id text,
  sent_at timestamptz not null default now()
);
create index recap_emails_sender on public.recap_emails (sent_by, sent_at);
alter table public.recap_emails enable row level security;
create policy "sender reads recaps" on public.recap_emails for select using (sent_by = auth.uid());
revoke all on public.recap_emails from anon, authenticated;
grant select on public.recap_emails to authenticated;

-- ---------- Custom summary templates ----------

create table public.summary_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,  -- set = shared with the team
  name text not null check (length(trim(name)) between 1 and 60),
  instructions text not null check (length(instructions) between 1 and 4000),
  -- Built-in type whose rules it builds on (site walks also get a site log).
  base text not null default 'meeting' check (base in ('general', 'meeting', 'lecture', 'phone_call', 'site_walk', 'sales_call', 'interview')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.summary_templates enable row level security;
create policy "read templates" on public.summary_templates for select
  using (user_id = auth.uid() or (workspace_id is not null and public.is_member(workspace_id)));
create policy "create templates" on public.summary_templates for insert
  with check (user_id = auth.uid() and (workspace_id is null or public.is_ws_admin(workspace_id)));
create policy "edit templates" on public.summary_templates for update
  using (user_id = auth.uid() or (workspace_id is not null and public.is_ws_admin(workspace_id)))
  with check (workspace_id is null or public.is_ws_admin(workspace_id));
create policy "delete templates" on public.summary_templates for delete
  using (user_id = auth.uid() or (workspace_id is not null and public.is_ws_admin(workspace_id)));
create trigger summary_templates_touch before update on public.summary_templates
  for each row execute function public.touch_updated_at();

alter table public.recordings add column custom_template_id uuid references public.summary_templates (id) on delete set null;

-- ---------- Retention ----------

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  audio_retention_days integer check (audio_retention_days is null or audio_retention_days between 1 and 3650),
  recording_retention_days integer check (recording_retention_days is null or recording_retention_days between 1 and 3650),
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "own settings" on public.user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- What the cleanup job should remove now. Service role only.
create or replace function public.retention_due(max_rows int default 500)
returns table (recording_id uuid, user_id uuid, action text)
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, 'delete_recording'
  from recordings r join user_settings s on s.user_id = r.user_id
  where s.recording_retention_days is not null and r.created_at < now() - make_interval(days => s.recording_retention_days)
  union all
  select r.id, r.user_id, 'delete_audio'
  from recordings r join user_settings s on s.user_id = r.user_id
  where s.audio_retention_days is not null and r.audio_deleted_at is null
    and r.created_at < now() - make_interval(days => s.audio_retention_days)
    and (s.recording_retention_days is null or r.created_at >= now() - make_interval(days => s.recording_retention_days))
  limit max_rows
$$;
revoke execute on function public.retention_due(int) from public, anon, authenticated;
grant execute on function public.retention_due(int) to service_role;

-- Account deletion: teams this user is the last owner of while others remain.
create or replace function public.teams_blocking_deletion(uid uuid)
returns table (workspace_id uuid, name text, members bigint)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, (select count(*) from workspace_members m2 where m2.workspace_id = w.id)
  from workspaces w
  join workspace_members m on m.workspace_id = w.id and m.user_id = uid and m.role = 'owner'
  where not exists (select 1 from workspace_members o where o.workspace_id = w.id and o.role = 'owner' and o.user_id <> uid)
    and exists (select 1 from workspace_members x where x.workspace_id = w.id and x.user_id <> uid)
$$;
revoke execute on function public.teams_blocking_deletion(uuid) from public, anon, authenticated;
grant execute on function public.teams_blocking_deletion(uuid) to service_role;

-- ---------- Attendee consent links ----------

create table public.consent_requests (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recording_id uuid references public.recordings (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 200),
  organizer text,             -- how the organizer is shown on the page (their email by default)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table public.consent_requests enable row level security;
create policy "own consent requests" on public.consent_requests for select using (user_id = auth.uid());
create policy "attach consent request" on public.consent_requests for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (recording_id is null or exists (select 1 from recordings r where r.id = recording_id and r.user_id = auth.uid())));
revoke all on public.consent_requests from anon, authenticated;
grant select on public.consent_requests to authenticated;
grant update (recording_id) on public.consent_requests to authenticated;

create table public.consent_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.consent_requests (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  email text check (email is null or length(email) <= 200),
  decision text not null check (decision in ('agree', 'decline')),
  created_at timestamptz not null default now()
);
create index consent_responses_request on public.consent_responses (request_id, created_at);
alter table public.consent_responses enable row level security;
-- The organizer sees responses; teammates who can read the recording see them too.
-- (A definer helper, because teammates can't read the request row itself.)
create or replace function public.can_read_consent(req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from consent_requests c
    where c.id = req and (c.user_id = auth.uid() or (c.recording_id is not null and public.can_read_recording(c.recording_id)))
  )
$$;
revoke execute on function public.can_read_consent(uuid) from anon;
create policy "read consent responses" on public.consent_responses for select using (public.can_read_consent(request_id));
revoke all on public.consent_responses from anon, authenticated;
grant select on public.consent_responses to authenticated;

create or replace function public.create_consent_request(req_title text, rec uuid default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if rec is not null and not exists (select 1 from recordings r where r.id = rec and r.user_id = auth.uid()) then
    raise exception 'Recording not found';
  end if;
  if (select count(*) from consent_requests where user_id = auth.uid() and created_at > now() - interval '1 day') >= 50 then
    raise exception 'Too many consent links today';
  end if;
  tok := translate(encode(gen_random_bytes(12), 'base64'), '+/', '-_');
  insert into consent_requests (token, user_id, recording_id, title, organizer)
    values (tok, auth.uid(), rec, left(coalesce(nullif(trim(req_title), ''), 'Meeting'), 200),
            nullif(auth.jwt() ->> 'email', ''));
  return tok;
end $$;
revoke execute on function public.create_consent_request(text, uuid) from anon;

-- ---------- Meeting bot ----------

create table public.meeting_bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recording_id uuid not null unique references public.recordings (id) on delete cascade,
  provider_bot_id text unique,
  meeting_url text not null check (meeting_url ~ '^https://' and length(meeting_url) <= 2000),
  join_at timestamptz,
  status text not null default 'scheduled',
  status_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meeting_bots enable row level security;
create policy "read bots" on public.meeting_bots for select using (user_id = auth.uid() or public.can_read_recording(recording_id));
-- Created and updated only by the `bot` Edge Function.
revoke all on public.meeting_bots from anon, authenticated;
grant select on public.meeting_bots to authenticated;
create trigger meeting_bots_touch before update on public.meeting_bots
  for each row execute function public.touch_updated_at();

-- ---------- Account deletion ----------
-- Deleting a user cascades to everything they own. Shared things must survive: a team's
-- projects and templates move to another owner/admin, tasks they added to teammates'
-- recordings move to the recording's owner, and a workspace they created stays with its
-- remaining members. Teams where they are the only member are removed.

alter table public.workspaces alter column created_by drop not null;
alter table public.workspaces drop constraint workspaces_created_by_fkey;
alter table public.workspaces add constraint workspaces_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

create or replace function public.prepare_account_deletion(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ws record; heir uuid;
begin
  if exists (select 1 from public.teams_blocking_deletion(uid)) then
    raise exception 'Transfer ownership of your teams first';
  end if;
  for ws in select m.workspace_id from workspace_members m where m.user_id = uid loop
    select m.user_id into heir from workspace_members m
      where m.workspace_id = ws.workspace_id and m.user_id <> uid
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at
      limit 1;
    if heir is null then
      delete from workspaces where id = ws.workspace_id;  -- nobody else is in it
    else
      update projects set user_id = heir where workspace_id = ws.workspace_id and user_id = uid;
      update summary_templates set user_id = heir where workspace_id = ws.workspace_id and user_id = uid;
    end if;
  end loop;
  update tasks t set user_id = r.user_id
    from recordings r
    where t.recording_id = r.id and t.user_id = uid and r.user_id <> uid;
end $$;
revoke execute on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
