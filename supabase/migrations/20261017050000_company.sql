-- Company controls: team policies, audit log, usage, verified domains + SSO, SCIM provisioning.

-- ---------- Team policies ----------

create table public.workspace_policies (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  redact text[] not null default '{}' check (redact <@ array['pii', 'phi', 'pci', 'numbers']::text[]),
  audio_retention_days int check (audio_retention_days between 1 and 3650),
  recording_retention_days int check (recording_retention_days between 1 and 3650),
  allow_public_links boolean not null default true,
  max_link_days int check (max_link_days between 1 and 365),
  require_consent boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.workspace_policies enable row level security;
create policy "members read policy" on public.workspace_policies for select using (public.is_member(workspace_id));
create policy "admins set policy" on public.workspace_policies for insert with check (public.is_ws_admin(workspace_id));
create policy "admins change policy" on public.workspace_policies for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));

create or replace function public.touch_policy() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger workspace_policies_touch before insert or update on public.workspace_policies for each row execute function public.touch_policy();

-- Turning public links off revokes the team's active links.
create or replace function public.policy_revoke_links() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.allow_public_links and (tg_op = 'INSERT' or old.allow_public_links) then
    update share_links l set revoked_at = now()
    from recordings r join projects p on p.id = r.project_id
    where l.recording_id = r.id and p.workspace_id = new.workspace_id and l.revoked_at is null;
  end if;
  return new;
end $$;
create trigger workspace_policies_links after insert or update on public.workspace_policies for each row execute function public.policy_revoke_links();

-- The policy that governs a recording (via its project's team), if any.
create or replace function public.policy_for_recording(rec uuid)
returns public.workspace_policies language sql stable security definer set search_path = public as $$
  select wp.* from recordings r join projects p on p.id = r.project_id join workspace_policies wp on wp.workspace_id = p.workspace_id where r.id = rec
$$;
revoke execute on function public.policy_for_recording(uuid) from anon;

-- Share links follow the team's policy.
create or replace function public.create_share_link_v2(rec uuid, opts jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text; pw text := nullif(opts ->> 'password', ''); days int := (opts ->> 'valid_days')::int; pol workspace_policies;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from recordings r where r.id = rec and r.user_id = auth.uid()) then
    raise exception 'Only the person who made this recording can share it';
  end if;
  pol := policy_for_recording(rec);
  if pol.workspace_id is not null and not pol.allow_public_links then
    raise exception 'Your team has turned off public links for its projects';
  end if;
  if pol.max_link_days is not null then days := least(coalesce(days, pol.max_link_days), pol.max_link_days); end if;
  if (select count(*) from share_links where recording_id = rec and revoked_at is null) >= 25 then
    raise exception 'This recording already has 25 active links. Turn one off first.';
  end if;
  if pw is not null and length(pw) < 6 then raise exception 'Use a password of at least 6 characters'; end if;
  tok := translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into share_links (token, recording_id, created_by, include_transcript, expires_at, allow_audio, allow_questions,
                           password_hash, clip_start_ms, clip_end_ms, title)
  values (tok, rec, auth.uid(), coalesce((opts ->> 'include_transcript')::boolean, false),
          case when days is null then null else now() + make_interval(days => least(greatest(days, 1), 365)) end,
          coalesce((opts ->> 'allow_audio')::boolean, false), coalesce((opts ->> 'allow_questions')::boolean, false),
          case when pw is null then null else crypt(pw, gen_salt('bf')) end,
          (opts ->> 'clip_start_ms')::int, (opts ->> 'clip_end_ms')::int, left(nullif(opts ->> 'title', ''), 120));
  return tok;
end $$;
revoke execute on function public.create_share_link_v2(uuid, jsonb) from anon;

-- Moving a recording into a team project with links off revokes its links too.
create or replace function public.recording_move_links() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id and exists (
    select 1 from projects p join workspace_policies wp on wp.workspace_id = p.workspace_id where p.id = new.project_id and not wp.allow_public_links
  ) then
    update share_links set revoked_at = now() where recording_id = new.id and revoked_at is null;
  end if;
  return new;
end $$;
create trigger recordings_move_links after update of project_id on public.recordings for each row execute function public.recording_move_links();

-- Retention: the owner's settings, and the team's for recordings in its projects. Shortest wins.
create or replace function public.retention_due(max_rows int default 500)
returns table (recording_id uuid, user_id uuid, action text)
language sql stable security definer set search_path = public as $$
  with limits as (
    select r.id, r.user_id, r.created_at, r.audio_deleted_at,
      nullif(least(coalesce(s.recording_retention_days, 100000), coalesce(wp.recording_retention_days, 100000)), 100000) as rec_days,
      nullif(least(coalesce(s.audio_retention_days, 100000), coalesce(wp.audio_retention_days, 100000)), 100000) as audio_days
    from recordings r
    left join user_settings s on s.user_id = r.user_id
    left join projects p on p.id = r.project_id
    left join workspace_policies wp on wp.workspace_id = p.workspace_id
  )
  select id, user_id, 'delete_recording' from limits
  where rec_days is not null and created_at < now() - make_interval(days => rec_days)
  union all
  select id, user_id, 'delete_audio' from limits
  where audio_days is not null and audio_deleted_at is null and created_at < now() - make_interval(days => audio_days)
    and (rec_days is null or created_at >= now() - make_interval(days => rec_days))
  limit max_rows
$$;
revoke execute on function public.retention_due(int) from public, anon, authenticated;
grant execute on function public.retention_due(int) to service_role;

-- ---------- Audit log ----------

create table public.audit_events (
  id bigserial primary key,
  workspace_id uuid references public.workspaces (id) on delete cascade, -- null = personal
  actor uuid references auth.users (id) on delete set null,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_ws on public.audit_events (workspace_id, created_at desc);
create index audit_events_actor on public.audit_events (actor, created_at desc) where workspace_id is null;
alter table public.audit_events enable row level security;
create policy "admins read team audit" on public.audit_events for select
  using ((workspace_id is not null and public.is_ws_admin(workspace_id)) or (workspace_id is null and actor = auth.uid()));
revoke insert, update, delete on public.audit_events from anon, authenticated;

create or replace function public.audit(ws uuid, act text, ttype text, tid text, m jsonb default '{}', who uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare a uuid := coalesce(auth.uid(), who);
begin
  -- While a team is being deleted its rows go too; the deletion itself is logged for the actor.
  if ws is not null and not exists (select 1 from workspaces where id = ws) then return; end if;
  insert into audit_events (workspace_id, actor, actor_email, action, target_type, target_id, meta)
  values (ws, a, (select email from auth.users where id = a), act, ttype, tid, coalesce(m, '{}'));
end $$;
revoke execute on function public.audit(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.audit(uuid, text, text, text, jsonb, uuid) to service_role;

create or replace function public.ws_of_recording(rec uuid) returns uuid language sql stable security definer set search_path = public as $$
  select p.workspace_id from recordings r join projects p on p.id = r.project_id where r.id = rec
$$;

create or replace function public.audit_workspace_deleted() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform audit(null, 'team.deleted', 'team', old.id::text, jsonb_build_object('name', old.name));
  return null;
end $$;
create trigger audit_workspaces_deleted after delete on public.workspaces for each row execute function public.audit_workspace_deleted();

create or replace function public.audit_members() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform audit(new.workspace_id, 'member.added', 'user', new.user_id::text, jsonb_build_object('email', new.email, 'role', new.role));
  elsif tg_op = 'DELETE' then perform audit(old.workspace_id, 'member.removed', 'user', old.user_id::text, jsonb_build_object('email', old.email));
  elsif new.role is distinct from old.role then perform audit(new.workspace_id, 'member.role_changed', 'user', new.user_id::text, jsonb_build_object('email', new.email, 'from', old.role, 'to', new.role));
  end if;
  return null;
end $$;
create trigger audit_workspace_members after insert or update or delete on public.workspace_members for each row execute function public.audit_members();

create or replace function public.audit_invites() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform audit(new.workspace_id, 'invite.created', 'invite', new.id::text, jsonb_build_object('email', new.email, 'role', new.role));
  elsif exists (select 1 from workspaces where id = old.workspace_id) then
    perform audit(old.workspace_id, 'invite.removed', 'invite', old.id::text, jsonb_build_object('email', old.email));
  end if;
  return null;
end $$;
create trigger audit_workspace_invites after insert or delete on public.workspace_invites for each row execute function public.audit_invites();

create or replace function public.audit_policy() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform audit(new.workspace_id, 'policy.updated', 'policy', new.workspace_id::text,
    to_jsonb(new) - 'workspace_id' - 'updated_at' - 'updated_by');
  return null;
end $$;
create trigger audit_workspace_policies after insert or update on public.workspace_policies for each row execute function public.audit_policy();

create or replace function public.audit_share_links() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform audit(ws_of_recording(new.recording_id), 'share_link.created', 'recording', new.recording_id::text,
      jsonb_build_object('link', new.id, 'transcript', new.include_transcript, 'audio', new.allow_audio, 'password', new.password_hash is not null, 'expires_at', new.expires_at));
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform audit(ws_of_recording(new.recording_id), 'share_link.revoked', 'recording', new.recording_id::text, jsonb_build_object('link', new.id));
  end if;
  return null;
end $$;
create trigger audit_share_links after insert or update of revoked_at on public.share_links for each row execute function public.audit_share_links();

create or replace function public.audit_recordings() returns trigger language plpgsql security definer set search_path = public as $$
declare old_ws uuid; new_ws uuid;
begin
  if tg_op = 'DELETE' then
    select workspace_id into old_ws from projects where id = old.project_id;
    perform audit(old_ws, 'recording.deleted', 'recording', old.id::text, jsonb_build_object('title', old.title, 'owner', old.user_id));
  elsif new.project_id is distinct from old.project_id then
    select workspace_id into old_ws from projects where id = old.project_id;
    select workspace_id into new_ws from projects where id = new.project_id;
    if old_ws is not null then perform audit(old_ws, 'recording.moved_out', 'recording', new.id::text, jsonb_build_object('title', new.title)); end if;
    if new_ws is not null then perform audit(new_ws, 'recording.moved_in', 'recording', new.id::text, jsonb_build_object('title', new.title)); end if;
  end if;
  return null;
end $$;
create trigger audit_recordings after update of project_id or delete on public.recordings for each row execute function public.audit_recordings();

create or replace function public.audit_projects() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.workspace_id is not null then perform audit(new.workspace_id, 'project.created', 'project', new.id::text, jsonb_build_object('name', new.name));
  elsif tg_op = 'DELETE' and old.workspace_id is not null and exists (select 1 from workspaces where id = old.workspace_id) then
    perform audit(old.workspace_id, 'project.deleted', 'project', old.id::text, jsonb_build_object('name', old.name));
  elsif tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    if old.workspace_id is not null then perform audit(old.workspace_id, 'project.moved_out', 'project', new.id::text, jsonb_build_object('name', new.name)); end if;
    if new.workspace_id is not null then perform audit(new.workspace_id, 'project.moved_in', 'project', new.id::text, jsonb_build_object('name', new.name)); end if;
  end if;
  return null;
end $$;
create trigger audit_projects after insert or update of workspace_id or delete on public.projects for each row execute function public.audit_projects();

-- Personal security events: access tokens, linked devices, connected apps.
create or replace function public.audit_personal() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb; what text;
begin
  j := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  what := case tg_table_name when 'api_tokens' then 'api_token' when 'device_tokens' then 'device' else 'connection' end;
  perform audit(null, what || case when tg_op = 'DELETE' then '.removed' else '.added' end, what,
    coalesce(j ->> 'provider', j ->> 'id'),
    case when what = 'connection' then jsonb_build_object('provider', j ->> 'provider') else jsonb_build_object('name', j ->> 'name') end,
    (j ->> 'user_id')::uuid);
  return null;
end $$;
create trigger audit_api_tokens after insert or delete on public.api_tokens for each row execute function public.audit_personal();
create trigger audit_device_tokens after insert or delete on public.device_tokens for each row execute function public.audit_personal();
create trigger audit_integrations after insert or delete on public.integrations for each row execute function public.audit_personal();

-- ---------- Usage (admins) ----------
-- Team-project recordings only; members' personal recordings stay private.

create or replace function public.workspace_usage(ws uuid, days int default 30)
returns table (user_id uuid, email text, role text, recordings bigint, minutes numeric, last_recording_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.email, m.role,
    count(r.id), round(coalesce(sum(r.duration_ms), 0) / 60000.0, 1), max(r.created_at)
  from workspace_members m
  left join projects p on p.workspace_id = ws
  left join recordings r on r.project_id = p.id and r.user_id = m.user_id and r.created_at > now() - make_interval(days => least(greatest(days, 1), 365))
  where m.workspace_id = ws and public.is_ws_admin(ws)
  group by m.user_id, m.email, m.role
  order by 5 desc, 2
$$;
revoke execute on function public.workspace_usage(uuid, int) from anon;

-- ---------- Verified email domains (auto-join) and single sign-on ----------

create table public.workspace_domains (
  domain text primary key check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  verify_token text not null default 'murmur-verify=' || encode(extensions.gen_random_bytes(16), 'hex'),
  verified_at timestamptz,
  auto_join boolean not null default true,
  sso_provider_id text,           -- set by the operator after `supabase sso add` (see docs/security/sso.md)
  sso_required boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.workspace_domains enable row level security;
create policy "admins see domains" on public.workspace_domains for select using (public.is_ws_admin(workspace_id));
create policy "admins add domains" on public.workspace_domains for insert with check (public.is_ws_admin(workspace_id) and verified_at is null and sso_provider_id is null and not sso_required);
create policy "admins change domains" on public.workspace_domains for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy "admins remove domains" on public.workspace_domains for delete using (public.is_ws_admin(workspace_id));
revoke insert, update on public.workspace_domains from authenticated;
grant insert (domain, workspace_id, auto_join), update (auto_join) on public.workspace_domains to authenticated;

-- Public: does this email's domain sign in with SSO? (Only verified domains with a provider.)
create or replace function public.sso_for_email(email text)
returns table (sso boolean, required boolean) language sql stable security definer set search_path = public as $$
  select d.sso_provider_id is not null, d.sso_required from workspace_domains d
  where d.domain = lower(split_part(email, '@', 2)) and d.verified_at is not null
$$;
grant execute on function public.sso_for_email(text) to anon, authenticated;

-- After sign-in: join teams that claim my (confirmed) email's verified domain.
create or replace function public.join_domain_teams()
returns int language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); em text; n int := 0; d record;
begin
  select email into em from auth.users where id = me and email_confirmed_at is not null;
  if em is null then return 0; end if;
  for d in select workspace_id from workspace_domains where domain = lower(split_part(em, '@', 2)) and verified_at is not null and auto_join loop
    insert into workspace_members (workspace_id, user_id, role, email) values (d.workspace_id, me, 'member', em) on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.join_domain_teams() from anon;

-- ---------- SCIM provisioning tokens (Okta, Entra ID, OneLogin) ----------

create table public.scim_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  token_hash text not null unique,
  prefix text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.scim_tokens enable row level security;
create policy "admins see scim tokens" on public.scim_tokens for select using (public.is_ws_admin(workspace_id));
create policy "admins revoke scim tokens" on public.scim_tokens for delete using (public.is_ws_admin(workspace_id));
revoke all on public.scim_tokens from anon, authenticated;
grant select (id, workspace_id, prefix, created_at, last_used_at), delete on public.scim_tokens to authenticated;

create or replace function public.create_scim_token(ws uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  if not is_ws_admin(ws) then raise exception 'Only team admins can do this'; end if;
  if (select count(*) from scim_tokens where workspace_id = ws) >= 3 then raise exception 'Revoke an old SCIM token first (3 at most)'; end if;
  tok := 'scim_' || encode(gen_random_bytes(24), 'hex');
  insert into scim_tokens (workspace_id, token_hash, prefix, created_by) values (ws, encode(digest(tok, 'sha256'), 'hex'), left(tok, 10), auth.uid());
  perform audit(ws, 'scim_token.created', 'scim_token', left(tok, 10));
  return tok;
end $$;
revoke execute on function public.create_scim_token(uuid) from anon;

-- Service only (SCIM): people by email, and a team's members with their emails.
create or replace function public.user_id_by_email(em text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(em) limit 1
$$;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;

create or replace function public.scim_members(ws uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, lower(coalesce(u.email, m.email)), m.role, m.joined_at
  from workspace_members m left join auth.users u on u.id = m.user_id where m.workspace_id = ws order by m.joined_at
$$;
revoke execute on function public.scim_members(uuid) from public, anon, authenticated;
grant execute on function public.scim_members(uuid) to service_role;
