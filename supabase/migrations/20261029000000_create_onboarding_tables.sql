
-- Tracks a user's progress through onboarding tours and the getting-started checklist.
-- One row per user, created lazily by the client on first sign-in.
create table public.user_onboarding (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tour_version_seen int not null default 0,
  tour_completed_at timestamptz,
  tour_skipped_at timestamptz,
  tour_last_step int,
  checklist_hidden boolean not null default false,
  tips_seen text[] not null default '{}',
  first_search_at timestamptz,
  first_ready_opened_at timestamptz,
  first_task_action_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_onboarding enable row level security;

-- Private to the user: nobody else sees or changes their onboarding state.
create policy "own onboarding read" on public.user_onboarding
  for select using (auth.uid() = user_id);
create policy "own onboarding insert" on public.user_onboarding
  for insert with check (auth.uid() = user_id);
create policy "own onboarding update" on public.user_onboarding
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own onboarding delete" on public.user_onboarding
  for delete using (auth.uid() = user_id);

-- Keeps updated_at current on every client write.
create trigger onboarding_touch_updated_at
  before update on public.user_onboarding
  for each row execute function public.touch_updated_at();

-- Append-only log of tour interactions (started, viewed, skipped, completed, etc.).
-- No recording content is ever stored here.
create table public.onboarding_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event text not null,
  step int,
  at timestamptz not null default now()
);

create index onboarding_events_user_at on public.onboarding_events (user_id, at desc);

alter table public.onboarding_events enable row level security;

-- Users write their own events and can read them back; nobody can edit history.
create policy "own events insert" on public.onboarding_events
  for insert with check (auth.uid() = user_id);
create policy "own events read" on public.onboarding_events
  for select using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_onboarding to authenticated;
grant select, insert on public.onboarding_events to authenticated;
