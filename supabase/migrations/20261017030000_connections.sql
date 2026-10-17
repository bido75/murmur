-- Connections and automations: webhooks, more trackers and destinations (Slack, CRMs, Notion,
-- Google Docs, OneNote), automation rules, topic alerts, weekly digest and automatic notetaker.

-- ---------- More providers ----------

alter table public.integrations drop constraint integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check check (provider in (
  'asana', 'linear', 'jira', 'procore', 'monday', 'clickup', 'trello',
  'hubspot', 'salesforce', 'slack', 'notion', 'google_docs', 'onenote', 'aircall'
));
alter table public.integration_oauth_states drop constraint integration_oauth_states_provider_check;
alter table public.integration_oauth_states add constraint integration_oauth_states_provider_check
  check (provider in ('procore', 'slack', 'salesforce', 'google_docs', 'onenote'));

-- Where a recording's notes were sent (e.g. {"notion": {"url": "…"}, "hubspot": {...}}), so nothing is sent twice by accident.
alter table public.summaries add column exports jsonb not null default '{}'::jsonb;

-- ---------- Webhooks ----------

create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (url ~ '^https://' and length(url) <= 2000),
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  events text[] not null default array['recording.ready'] check (events <@ array['recording.ready', 'recording.failed', 'task.created']::text[]),
  project_id uuid references public.projects (id) on delete cascade,  -- null = all my recordings
  active boolean not null default true,
  last_status integer,
  last_error text,
  last_delivery_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.webhooks enable row level security;
create policy "own webhooks" on public.webhooks for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Automations ----------
-- "When a recording [in this project] [of this type] is ready, do these things."
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  project_id uuid references public.projects (id) on delete cascade,
  template text,
  actions jsonb not null check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 10),
  active boolean not null default true,
  last_run_at timestamptz,
  last_result text,
  created_at timestamptz not null default now()
);
alter table public.automations enable row level security;
create policy "own automations" on public.automations for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Topic alerts ----------

create table public.topic_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  phrase text not null check (length(trim(phrase)) between 2 and 80),
  project_id uuid references public.projects (id) on delete cascade,
  email boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.topic_alerts enable row level security;
create policy "own topic alerts" on public.topic_alerts for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Weekly digest and automatic notetaker ----------

alter table public.user_settings add column weekly_digest boolean not null default false;
alter table public.user_settings add column auto_notetaker boolean not null default false;
alter table public.user_settings add column timezone text check (timezone is null or length(timezone) <= 64);
alter table public.user_settings add column digest_sent_at timestamptz;

-- A notetaker sent automatically for a calendar meeting isn't sent twice.
alter table public.meeting_bots add column event_key text;
alter table public.meeting_bots add column event_start timestamptz;
create unique index meeting_bots_event on public.meeting_bots (user_id, event_key, event_start) where event_key is not null;
