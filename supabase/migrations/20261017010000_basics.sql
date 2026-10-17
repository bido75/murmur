-- Everyday basics: editable notes and transcripts, speaker names, push notifications,
-- richer share links (audio, questions, password, clips), comments and bookmarks,
-- notes typed during a meeting, and search results that point at the moment.

-- ---------- Editing ----------

-- The owner can correct the notes (the AI wrote them; people fix them).
create policy "owner edits summaries" on public.summaries for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.summaries add column edited_at timestamptz;
alter table public.transcripts add column edited_at timestamptz;

-- Keep the searchable text in step with edited utterances.
create or replace function public.transcript_text_sync() returns trigger
language plpgsql as $$
begin
  if new.utterances is distinct from old.utterances then
    new.text := coalesce((select string_agg(u->>'text', ' ') from jsonb_array_elements(new.utterances) u), '');
  end if;
  return new;
end $$;
create trigger transcripts_text_sync before update on public.transcripts
  for each row execute function public.transcript_text_sync();

-- Notes the person typed while recording; the AI fills them out from the transcript.
alter table public.recordings add column user_notes text check (user_notes is null or length(user_notes) <= 20000);

-- ---------- Push notifications ----------

create table public.push_tokens (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;
create policy "own push tokens" on public.push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Share links: audio, questions, password, clips ----------

alter table public.share_links add column allow_audio boolean not null default false;
alter table public.share_links add column allow_questions boolean not null default false;
alter table public.share_links add column password_hash text;
-- Whether a link has a password, readable without exposing the hash.
alter table public.share_links add column has_password boolean generated always as (password_hash is not null) stored;
alter table public.share_links add column clip_start_ms integer check (clip_start_ms is null or clip_start_ms >= 0);
alter table public.share_links add column clip_end_ms integer;
alter table public.share_links add column title text check (title is null or length(title) <= 120);
alter table public.share_links add constraint clip_range check (
  (clip_start_ms is null and clip_end_ms is null) or (clip_end_ms > clip_start_ms and clip_end_ms - clip_start_ms <= 10 * 60 * 1000)
);
-- The password hash is never readable by the app.
revoke select on public.share_links from authenticated;
grant select (id, token, recording_id, created_by, include_transcript, created_at, expires_at, revoked_at, views, last_viewed_at,
              allow_audio, allow_questions, clip_start_ms, clip_end_ms, title, has_password) on public.share_links to authenticated;

create or replace function public.create_share_link_v2(rec uuid, opts jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text; pw text := nullif(opts ->> 'password', ''); days int := (opts ->> 'valid_days')::int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from recordings r where r.id = rec and r.user_id = auth.uid()) then
    raise exception 'Only the person who made this recording can share it';
  end if;
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

-- Server-side password check for the public share endpoint (service role only).
create or replace function public.share_password_ok(tok text, pw text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select password_hash is null or (pw is not null and password_hash = crypt(pw, password_hash)) from share_links where token = tok), false)
$$;
revoke execute on function public.share_password_ok(text, text) from public, anon, authenticated;
grant execute on function public.share_password_ok(text, text) to service_role;

-- Questions asked on shared pages (for rate limiting).
create table public.share_questions (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.share_links (id) on delete cascade,
  asked_at timestamptz not null default now()
);
create index share_questions_link on public.share_questions (link_id, asked_at);
alter table public.share_questions enable row level security;
revoke all on public.share_questions from anon, authenticated;

-- ---------- Comments and bookmarks ----------

create table public.recording_comments (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text,
  kind text not null default 'comment' check (kind in ('comment', 'bookmark')),
  at_ms integer check (at_ms is null or at_ms >= 0),
  body text not null default '' check (length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index recording_comments_recording on public.recording_comments (recording_id, at_ms);
alter table public.recording_comments enable row level security;
create policy "read comments" on public.recording_comments for select using (public.can_read_recording(recording_id));
create policy "add comments" on public.recording_comments for insert
  with check (user_id = auth.uid() and public.can_read_recording(recording_id));
create policy "edit own comments" on public.recording_comments for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own comments" on public.recording_comments for delete
  using (user_id = auth.uid() or exists (select 1 from recordings r where r.id = recording_id and r.user_id = auth.uid()));

-- ---------- Search: where in the recording the words were said ----------

drop function public.search_recordings(text, int);
create or replace function public.search_recordings(q text, max_results int default 30)
returns table (recording_id uuid, title text, created_at timestamptz, project_id uuid, template text, snippet text, matched text, rank real, at_ms integer)
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
    (coalesce(ts_rank(t.search, qq.tsq), 0) + case when r.title ilike qq.pat then 1 else 0 end)::real,
    case when t.search @@ qq.tsq then (
      select (u ->> 'start_ms')::int from jsonb_array_elements(t.utterances) u
      where to_tsvector('simple', coalesce(u ->> 'text', '')) @@ qq.tsq
      order by (u ->> 'start_ms')::int limit 1
    ) end
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
