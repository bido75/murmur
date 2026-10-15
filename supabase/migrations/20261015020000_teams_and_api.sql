-- Phase 2, batch 2: team workspaces and personal API tokens (for the MCP server).
--
-- Sharing model:
-- - A project can belong to a workspace. Every member of that workspace can read the
--   project's recordings, transcripts, notes and tasks, and can update its tasks.
-- - Only the person who made a recording can rename, move, re-run or delete it.
-- - Personal projects (no workspace) stay private, exactly as before.

-- ---------- Workspaces ----------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  email text,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user on public.workspace_members (user_id);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  code text not null unique,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id)
);

alter table public.projects add column workspace_id uuid references public.workspaces (id) on delete cascade;
create index projects_workspace on public.projects (workspace_id);

-- ---------- Access helpers ----------
-- SECURITY DEFINER so policies can call them without recursive RLS checks.
-- The uid argument only applies to server-side callers (no session); a signed-in user is
-- always checked as themselves, so nobody can probe what another user can see.

create or replace function public.is_member(ws uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members m where m.workspace_id = ws and m.user_id = coalesce(auth.uid(), uid))
$$;

create or replace function public.is_ws_admin(ws uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members m where m.workspace_id = ws and m.user_id = coalesce(auth.uid(), uid) and m.role in ('owner', 'admin'))
$$;

create or replace function public.can_read_project(pid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = pid and (p.user_id = coalesce(auth.uid(), uid) or (p.workspace_id is not null and public.is_member(p.workspace_id, uid)))
  )
$$;

create or replace function public.can_read_recording(rid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from recordings r
    where r.id = rid and (r.user_id = coalesce(auth.uid(), uid) or (r.project_id is not null and public.can_read_project(r.project_id, uid)))
  )
$$;

revoke execute on function public.is_member(uuid, uuid), public.is_ws_admin(uuid, uuid),
  public.can_read_project(uuid, uuid), public.can_read_recording(uuid, uuid) from anon;

-- ---------- Workspace policies ----------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

create policy "members read workspace" on public.workspaces for select using (public.is_member(id));
create policy "admins rename workspace" on public.workspaces for update using (public.is_ws_admin(id)) with check (public.is_ws_admin(id));
create policy "owner deletes workspace" on public.workspaces for delete
  using (exists (select 1 from workspace_members m where m.workspace_id = workspaces.id and m.user_id = auth.uid() and m.role = 'owner'));
-- Creating a workspace goes through create_workspace() so the creator becomes owner atomically.

create policy "members see members" on public.workspace_members for select using (public.is_member(workspace_id));
-- Membership changes go through the functions below.

create policy "admins see invites" on public.workspace_invites for select using (public.is_ws_admin(workspace_id));
create policy "admins revoke invites" on public.workspace_invites for delete using (public.is_ws_admin(workspace_id));

-- ---------- Replace owner-only policies with shared-read policies ----------

drop policy "own projects" on public.projects;
-- Policies check the row's own columns (not a re-lookup by id), so INSERT ... RETURNING works.
create policy "read projects" on public.projects for select
  using (user_id = auth.uid() or (workspace_id is not null and public.is_member(workspace_id)));
create policy "create projects" on public.projects for insert
  with check (user_id = auth.uid() and (workspace_id is null or public.is_member(workspace_id)));
create policy "edit projects" on public.projects for update
  using (user_id = auth.uid() or (workspace_id is not null and public.is_ws_admin(workspace_id)))
  with check (workspace_id is null or public.is_member(workspace_id));
create policy "delete projects" on public.projects for delete
  using (user_id = auth.uid() or (workspace_id is not null and public.is_ws_admin(workspace_id)));

drop policy "own recordings" on public.recordings;
create policy "read recordings" on public.recordings for select
  using (user_id = auth.uid() or (project_id is not null and public.can_read_project(project_id)));
create policy "create recordings" on public.recordings for insert
  with check (user_id = auth.uid() and (project_id is null or public.can_read_project(project_id)));
create policy "owner edits recordings" on public.recordings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (project_id is null or public.can_read_project(project_id)));
create policy "owner deletes recordings" on public.recordings for delete using (user_id = auth.uid());

drop policy "own segments" on public.recording_segments;
create policy "read segments" on public.recording_segments for select using (public.can_read_recording(recording_id));
create policy "owner writes segments" on public.recording_segments for insert with check (user_id = auth.uid());
create policy "owner updates segments" on public.recording_segments for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner deletes segments" on public.recording_segments for delete using (user_id = auth.uid());

drop policy "own transcripts" on public.transcripts;
create policy "read transcripts" on public.transcripts for select using (public.can_read_recording(recording_id));
create policy "owner edits transcripts" on public.transcripts for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy "own summaries" on public.summaries;
create policy "read summaries" on public.summaries for select using (public.can_read_recording(recording_id));

-- Tasks: anyone who can read the recording can tick, reassign or dismiss its tasks.
drop policy "own tasks" on public.tasks;
create policy "read tasks" on public.tasks for select
  using (user_id = auth.uid() or (recording_id is not null and public.can_read_recording(recording_id)));
create policy "create tasks" on public.tasks for insert
  with check (user_id = auth.uid() and (recording_id is null or public.can_read_recording(recording_id)));
create policy "update tasks" on public.tasks for update
  using (user_id = auth.uid() or (recording_id is not null and public.can_read_recording(recording_id)))
  with check (user_id = auth.uid() or (recording_id is not null and public.can_read_recording(recording_id)));
create policy "delete own tasks" on public.tasks for delete using (user_id = auth.uid());

-- Teammates can play audio of recordings they can read. Path: <owner>/<recording_id>/<file>
drop policy "own audio read" on storage.objects;
create policy "read audio" on storage.objects for select using (
  bucket_id = 'audio' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.can_read_recording(nullif((storage.foldername(name))[2], '')::uuid)
  )
);

-- Search covers everything the user can read, not just their own recordings.
create or replace function public.search_transcripts(q text, max_results int default 8)
returns table (recording_id uuid, rank real)
language sql stable security invoker as $$
  select t.recording_id, ts_rank(t.search, websearch_to_tsquery('simple', q)) as rank
  from public.transcripts t
  where t.search @@ websearch_to_tsquery('simple', q)
    and public.can_read_recording(t.recording_id)
  order by rank desc
  limit max_results
$$;

-- ---------- Workspace functions ----------

create or replace function public.create_workspace(ws_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into workspaces (name, created_by) values (trim(ws_name), me) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role, email)
    values (ws, me, 'owner', (select email from auth.users where id = me));
  return ws;
end $$;

create or replace function public.create_invite(ws uuid, invitee_email text, invite_role text default 'member')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  if not public.is_ws_admin(ws) then raise exception 'Only team admins can invite people'; end if;
  if invite_role not in ('admin', 'member') then raise exception 'Invalid role'; end if;
  -- 10 characters from an unambiguous alphabet, e.g. K7M4-QX9P2T
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
    into c
    from (select gen_random_bytes(10) as b) r, generate_series(0, 9) as i;
  insert into workspace_invites (workspace_id, email, role, code, invited_by)
    values (ws, lower(trim(invitee_email)), invite_role, c, auth.uid());
  return c;
end $$;

-- The invite is tied to an email address: only the person signed in with it can use it.
create or replace function public.accept_invite(invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv workspace_invites; me uuid := auth.uid(); my_email text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select lower(email) into my_email from auth.users where id = me;
  select * into inv from workspace_invites
    where code = upper(replace(trim(invite_code), '-', '')) for update;
  if inv.id is null then raise exception 'That invite code is not valid'; end if;
  if inv.accepted_at is not null then raise exception 'That invite has already been used'; end if;
  if inv.expires_at < now() then raise exception 'That invite has expired. Ask for a new one.'; end if;
  if inv.email <> my_email then raise exception 'This invite was sent to a different email address'; end if;
  insert into workspace_members (workspace_id, user_id, role, email)
    values (inv.workspace_id, me, inv.role, my_email)
    on conflict (workspace_id, user_id) do nothing;
  update workspace_invites set accepted_at = now(), accepted_by = me where id = inv.id;
  return inv.workspace_id;
end $$;

create or replace function public.set_member_role(ws uuid, member uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ws_admin(ws) then raise exception 'Only team admins can change roles'; end if;
  if new_role not in ('owner', 'admin', 'member') then raise exception 'Invalid role'; end if;
  if new_role <> 'owner' and (select role from workspace_members where workspace_id = ws and user_id = member) = 'owner'
     and (select count(*) from workspace_members where workspace_id = ws and role = 'owner') = 1 then
    raise exception 'A team needs at least one owner';
  end if;
  update workspace_members set role = new_role where workspace_id = ws and user_id = member;
end $$;

-- Admins remove others; anyone can remove themselves (leave). The last owner can't leave.
create or replace function public.remove_member(ws uuid, member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if member <> auth.uid() and not public.is_ws_admin(ws) then raise exception 'Only team admins can remove people'; end if;
  if (select role from workspace_members where workspace_id = ws and user_id = member) = 'owner'
     and (select count(*) from workspace_members where workspace_id = ws and role = 'owner') = 1 then
    raise exception 'Make someone else owner before the last owner leaves';
  end if;
  delete from workspace_members where workspace_id = ws and user_id = member;
end $$;

revoke execute on function public.create_workspace(text), public.create_invite(uuid, text, text),
  public.accept_invite(text), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid) from anon;

-- ---------- Personal API tokens (MCP) ----------
-- Only a SHA-256 hash is stored; the token itself is shown once.

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.api_tokens enable row level security;
create policy "read own tokens" on public.api_tokens for select using (user_id = auth.uid());
create policy "revoke own tokens" on public.api_tokens for delete using (user_id = auth.uid());
revoke all on public.api_tokens from anon, authenticated;
grant select (id, user_id, name, prefix, created_at, last_used_at) on public.api_tokens to authenticated;
grant delete on public.api_tokens to authenticated;

create or replace function public.create_api_token(token_name text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text; me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if (select count(*) from api_tokens where user_id = me) >= 10 then raise exception 'You can have at most 10 tokens'; end if;
  tok := 'mur_' || encode(gen_random_bytes(24), 'hex');
  insert into api_tokens (user_id, name, token_hash, prefix)
    values (me, coalesce(nullif(trim(token_name), ''), 'API token'), encode(digest(tok, 'sha256'), 'hex'), left(tok, 10));
  return tok;
end $$;
revoke execute on function public.create_api_token(text) from anon;

-- ---------- Scope for server-side callers (MCP) ----------
-- Same rules as the policies above, for an explicit user. Service role only.

create or replace function public.readable_projects(uid uuid)
returns table (id uuid, name text, workspace_id uuid, team text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.workspace_id, w.name
  from projects p left join workspaces w on w.id = p.workspace_id
  where not p.archived and (p.user_id = uid or (p.workspace_id is not null and public.is_member(p.workspace_id, uid)))
$$;

create or replace function public.readable_recordings(uid uuid, max_rows int default 1000)
returns table (id uuid, user_id uuid, project_id uuid, title text, created_at timestamptz, status text, duration_ms int)
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, r.project_id, r.title, r.created_at, r.status, r.duration_ms
  from recordings r
  where r.user_id = uid or (r.project_id is not null and public.can_read_project(r.project_id, uid))
  order by r.created_at desc
  limit max_rows
$$;

revoke execute on function public.readable_projects(uuid), public.readable_recordings(uuid, int) from public, anon, authenticated;
grant execute on function public.readable_projects(uuid), public.readable_recordings(uuid, int) to service_role;
