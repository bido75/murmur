-- Transcription choices (language, redaction) and translations.

alter table public.user_settings add column language text
  check (language is null or language = 'multi' or language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$');
-- Personal details removed from transcripts (and so from notes): Deepgram redaction groups.
alter table public.user_settings add column redact text[] not null default '{}'
  check (redact <@ array['pii', 'phi', 'pci', 'numbers']::text[]);

-- Translated notes (and optionally transcript), cached per language. Written by the `translate` function.
create table public.translations (
  recording_id uuid not null references public.recordings (id) on delete cascade,
  lang text not null check (lang ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  summary jsonb,
  tasks jsonb,
  utterances jsonb,
  created_at timestamptz not null default now(),
  primary key (recording_id, lang)
);
alter table public.translations enable row level security;
create policy "read translations" on public.translations for select using (public.can_read_recording(recording_id));
revoke insert, update, delete on public.translations from anon, authenticated;
