-- Phase 2, batch 1: projects, task carry-over, consent log, tracker integrations, deck exports.

-- Projects group recordings (a client, a job site, a weekly standup...).
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user on public.projects (user_id, archived, created_at desc);
alter table public.projects enable row level security;
create policy "own projects" on public.projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

alter table public.recordings
  add column project_id uuid references public.projects (id) on delete set null;
create index recordings_project on public.recordings (project_id, created_at desc);

-- Carry-over: a later recording can close or update an earlier task, with proof.
alter table public.tasks
  add column completed_by_recording_id uuid references public.recordings (id) on delete set null,
  add column completion_quote text,
  add column completion_ms integer,
  add column progress_note text,
  add column external jsonb not null default '{}'::jsonb; -- { "linear": { "id", "key", "url" }, ... }

-- What this recording said about earlier tasks: [{ task_id, text, status, note, quote, quote_ms, verified }]
alter table public.summaries
  add column task_updates jsonb not null default '[]'::jsonb;

-- Consent log: how participants were told, recorded at the start of the recording.
alter table public.recordings
  add column consent_method text not null default 'not_confirmed'
    check (consent_method in ('told_everyone', 'in_invite', 'solo', 'not_confirmed'));

-- Task tracker connections. The token column is never readable by the app:
-- only Edge Functions (service role) read or write it.
create table public.integrations (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('asana', 'linear', 'jira')),
  config jsonb not null default '{}'::jsonb,   -- non-secret: account name, chosen team/project, Jira site + email
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.integrations enable row level security;
create policy "read own integrations" on public.integrations for select using (user_id = auth.uid());
create policy "delete own integrations" on public.integrations for delete using (user_id = auth.uid());
-- No insert/update policies: writes go through the `integrations` Edge Function.
revoke all on public.integrations from anon, authenticated;
grant select (user_id, provider, config, created_at, updated_at) on public.integrations to authenticated;
grant delete on public.integrations to authenticated;
create trigger integrations_touch before update on public.integrations
  for each row execute function public.touch_updated_at();

-- Generated decks. Files live at exports/<user_id>/<file>.pptx
insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

create policy "own exports read" on storage.objects for select
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own exports delete" on storage.objects for delete
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
