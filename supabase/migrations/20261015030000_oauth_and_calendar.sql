-- Phase 2, batch 3: OAuth 2.1 authorization server (for Claude.ai / ChatGPT MCP connectors)
-- and calendar connections. All of these tables are service-role only; the app reaches them
-- through the functions at the bottom.

-- ---------- OAuth ----------

create table public.oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- Authorization codes: single use, 10 minutes, bound to client, redirect URI, PKCE challenge and resource.
create table public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  resource text not null,
  scope text not null default 'mcp',
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);

-- Access tokens (1 hour) and refresh tokens (30 days, rotated on every use).
-- `family` links a refresh token to the ones it was rotated into; reusing an old refresh
-- token revokes the whole family (OAuth 2.1 refresh token reuse detection).
create table public.oauth_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access', 'refresh')),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  resource text not null,
  scope text not null default 'mcp',
  family uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_tokens_user on public.oauth_tokens (user_id, client_id);
create index oauth_tokens_family on public.oauth_tokens (family);

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
revoke all on public.oauth_clients, public.oauth_codes, public.oauth_tokens from anon, authenticated;

-- Atomically redeem a code (returns nothing if missing, used or expired).
create or replace function public.oauth_consume_code(p_hash text)
returns setof public.oauth_codes language sql volatile security definer set search_path = public as $$
  delete from oauth_codes where code_hash = p_hash and expires_at > now() returning *
$$;

-- Atomically rotate a refresh token. Returns the old row if it was valid and unused.
-- If it was already used, the whole family is revoked and nothing is returned.
create or replace function public.oauth_use_refresh(p_hash text)
returns setof public.oauth_tokens language plpgsql volatile security definer set search_path = public as $$
declare t oauth_tokens;
begin
  select * into t from oauth_tokens where token_hash = p_hash and kind = 'refresh' for update;
  if t.token_hash is null then return; end if;
  if t.used_at is not null then
    delete from oauth_tokens where family = t.family;
    return;
  end if;
  if t.expires_at <= now() then return; end if;
  update oauth_tokens set used_at = now() where token_hash = p_hash;
  return next t;
end $$;

revoke execute on function public.oauth_consume_code(text), public.oauth_use_refresh(text) from public, anon, authenticated;
grant execute on function public.oauth_consume_code(text), public.oauth_use_refresh(text) to service_role;

-- What the signed-in user has connected, and a way to disconnect it.
create or replace function public.my_connected_apps()
returns table (client_id text, client_name text, connected_at timestamptz, last_used_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.client_id, c.client_name, min(t.created_at), max(t.created_at)
  from oauth_tokens t join oauth_clients c on c.client_id = t.client_id
  where t.user_id = auth.uid() and t.expires_at > now() and t.used_at is null
  group by c.client_id, c.client_name
  order by max(t.created_at) desc
$$;

create or replace function public.disconnect_app(p_client_id text)
returns void language sql volatile security definer set search_path = public as $$
  delete from oauth_tokens where user_id = auth.uid() and client_id = p_client_id;
$$;

revoke execute on function public.my_connected_apps(), public.disconnect_app(text) from public, anon;
grant execute on function public.my_connected_apps(), public.disconnect_app(text) to authenticated;

-- ---------- Calendar ----------

-- One connection per provider per user. The refresh token never leaves the server.
create table public.calendar_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.calendar_connections enable row level security;
create policy "read own calendar connections" on public.calendar_connections for select using (user_id = auth.uid());
create policy "disconnect own calendar" on public.calendar_connections for delete using (user_id = auth.uid());
revoke all on public.calendar_connections from anon, authenticated;
grant select (user_id, provider, account_email, created_at) on public.calendar_connections to authenticated;
grant delete on public.calendar_connections to authenticated;

-- Short-lived state for the provider sign-in redirect (CSRF protection).
create table public.calendar_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  return_to text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.calendar_oauth_states enable row level security;
revoke all on public.calendar_oauth_states from anon, authenticated;

-- "This recurring meeting belongs to that project", so briefs know what to show.
create table public.calendar_links (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_key text not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_key)
);
alter table public.calendar_links enable row level security;
create policy "own calendar links" on public.calendar_links for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_read_project(project_id));

-- Recordings can remember which calendar event they came from.
alter table public.recordings add column calendar_event_key text;
