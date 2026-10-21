-- Plans, minutes and provider events.
--
-- The app never decides a plan: the server does, from a verified Stripe or RevenueCat webhook.
-- A user can read their own row and nothing else. The minutes used are worked out from the
-- audio they actually recorded, so a replayed event can never double-count them.

create table public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  period text not null default 'monthly' check (period in ('monthly', 'yearly')),
  minutes_included int not null default 60 check (minutes_included >= 0),
  minutes_used int not null default 0 check (minutes_used >= 0),
  current_period_end timestamptz not null default (now() + interval '1 month'),
  cancel_at timestamptz,
  provider text not null default 'none' check (provider in ('none', 'stripe', 'revenuecat')),
  provider_id text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every provider event we receive, so a repeat of the same event does nothing twice.
create table public.billing_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('stripe', 'revenuecat')),
  event_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  applied boolean not null default false,
  note text,
  unique (provider, event_id)
);

-- Switches a feature on or off on the server. The app asks the server, it never decides.
create table public.app_features (
  name text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.app_features (name) values ('billing');

-- A recording that is waiting for more minutes keeps its audio and its place in the queue.
alter table public.recordings add column if not exists notes_queued_at timestamptz;

create or replace trigger entitlements_touch before update on public.entitlements
for each row execute function public.touch_updated_at();

alter table public.entitlements enable row level security;
alter table public.billing_events enable row level security;
alter table public.app_features enable row level security;

create policy "you can read your own plan" on public.entitlements
for select using (user_id = auth.uid());

-- No insert, update or delete policy: only the server writes a plan.
create policy "billing events are server only" on public.billing_events
for all using (false) with check (false);

create policy "features are server only" on public.app_features
for all using (false) with check (false);

revoke all on public.entitlements from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.app_features from anon, authenticated;
grant select on public.entitlements to authenticated;

-- Work out how many minutes a user has used in the current plan period from their own
-- recordings. Called by the server, never by the app.
create or replace function public.sync_entitlement_usage(uid uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  e public.entitlements%rowtype;
  total_ms bigint := 0;
  used int := 0;
  start_at timestamptz;
begin
  select * into e from public.entitlements where user_id = uid for update;
  if not found then return 0; end if;

  start_at := e.current_period_end - (case when e.period = 'yearly' then interval '1 year' else interval '1 month' end);

  select coalesce(sum(greatest(r.duration_ms, 0)), 0) into total_ms
  from public.recordings r
  where r.user_id = uid
    and r.duration_ms > 0
    and r.created_at >= start_at
    and r.created_at < e.current_period_end;

  if total_ms > 0 then used := ceil(total_ms / 60000.0)::int; end if;
  update public.entitlements set minutes_used = used where user_id = uid;
  return used;
end;
$$;

revoke execute on function public.sync_entitlement_usage(uuid) from public, anon, authenticated;
grant execute on function public.sync_entitlement_usage(uuid) to service_role;

-- Is a feature switched on? The server asks; the app never decides.
create or replace function public.feature_enabled(flag text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.app_features where name = flag), false);
$$;

revoke execute on function public.feature_enabled(text) from public, anon, authenticated;
grant execute on function public.feature_enabled(text) to service_role;
