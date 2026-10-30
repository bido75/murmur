-- Per-user preferences that now sync across devices: the consent reminder,
-- field mode, and the default recording type. Previously kept only on the device.
alter table public.user_settings
  add column if not exists consent_reminder boolean not null default true,
  add column if not exists field_mode boolean not null default false,
  add column if not exists default_template text not null default 'meeting',
  add column if not exists my_state text;
