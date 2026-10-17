-- Capture everywhere: phone calls (Twilio), Aircall, browser extension, watches, screen recording,
-- and on-device transcription.

-- ---------- New sources and consent methods ----------

alter table public.recordings drop constraint recordings_source_check;
alter table public.recordings add constraint recordings_source_check
  check (source in ('mic', 'import', 'link', 'bot', 'phone', 'aircall', 'extension', 'watch', 'screen'));

alter table public.recordings drop constraint recordings_consent_method_check;
alter table public.recordings add constraint recordings_consent_method_check
  check (consent_method in ('told_everyone', 'in_invite', 'solo', 'consent_link', 'bot_announced', 'phone_announced', 'provider_announced', 'not_confirmed'));

-- An outside system's id for the same call (Twilio call, Aircall call), so retries don't duplicate it.
alter table public.recordings add column external_ref text check (external_ref is null or length(external_ref) <= 200);
create unique index recordings_external_ref on public.recordings (user_id, external_ref) where external_ref is not null;

-- Screen recordings keep their video for playback.
alter table public.recordings add column has_video boolean not null default false;
-- Transcribed on the phone: no audio was uploaded.
alter table public.recordings add column transcribed_on_device boolean not null default false;

-- ---------- Phone calls through a Murmur number ----------
-- The caller's number must be linked, and the PIN is asked on every call (caller ID can be faked).

create table public.phone_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.phone_links enable row level security;
create policy "read own phone link" on public.phone_links for select using (user_id = auth.uid());
create policy "remove own phone link" on public.phone_links for delete using (user_id = auth.uid());
revoke all on public.phone_links from anon, authenticated;
grant select (user_id, phone_e164, created_at, locked_until) on public.phone_links to authenticated;
grant delete on public.phone_links to authenticated;

create or replace function public.set_phone_link(phone text, pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'Enter the number with country code, e.g. +15125550123'; end if;
  if pin !~ '^[0-9]{4,8}$' then raise exception 'The PIN must be 4 to 8 digits'; end if;
  if pin ~ '^(.)\1+$' or pin in ('1234', '12345', '123456', '1234567', '12345678', '4321', '0123') then raise exception 'Choose a less obvious PIN'; end if;
  if exists (select 1 from phone_links where phone_e164 = phone and user_id <> me) then raise exception 'That number is linked to another account'; end if;
  insert into phone_links (user_id, phone_e164, pin_hash) values (me, phone, crypt(pin, gen_salt('bf', 8)))
  on conflict (user_id) do update set phone_e164 = excluded.phone_e164, pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
end $$;
revoke execute on function public.set_phone_link(text, text) from anon;

-- Service only: who is calling, and is the PIN right. Five wrong PINs lock the number for 30 minutes.
create or replace function public.phone_pin_check(phone text, pin text)
returns table (user_id uuid, ok boolean, locked boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare l phone_links;
begin
  select * into l from phone_links where phone_e164 = phone;
  if not found then return; end if;
  if l.locked_until is not null and l.locked_until > now() then
    return query select l.user_id, false, true; return;
  end if;
  if l.pin_hash = crypt(coalesce(pin, ''), l.pin_hash) then
    update phone_links set failed_attempts = 0, locked_until = null where phone_links.user_id = l.user_id;
    return query select l.user_id, true, false;
  else
    update phone_links set failed_attempts = case when l.failed_attempts + 1 >= 5 then 0 else l.failed_attempts + 1 end,
      locked_until = case when l.failed_attempts + 1 >= 5 then now() + interval '30 minutes' else null end
    where phone_links.user_id = l.user_id;
    return query select l.user_id, false, (l.failed_attempts + 1 >= 5);
  end if;
end $$;
revoke execute on function public.phone_pin_check(text, text) from public, anon, authenticated;

-- ---------- Devices: browser extension, Apple Watch, Wear OS ----------
-- The app shows a short code; the device trades it for an upload-only token.

create table public.device_links (
  code_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
alter table public.device_links enable row level security; -- no policies: definer functions only
revoke all on public.device_links from anon, authenticated;

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  kind text not null check (kind in ('extension', 'watch', 'wear', 'desktop', 'other')),
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.device_tokens enable row level security;
create policy "read own devices" on public.device_tokens for select using (user_id = auth.uid());
create policy "unlink own devices" on public.device_tokens for delete using (user_id = auth.uid());
revoke all on public.device_tokens from anon, authenticated;
grant select (id, user_id, name, kind, prefix, created_at, last_used_at) on public.device_tokens to authenticated;
grant delete on public.device_tokens to authenticated;

-- 8 characters without look-alikes (no 0/O, 1/I/L), shown as XXXX-XXXX.
create or replace function public.create_device_link()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; code text := ''; b bytea; i int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  delete from device_links where expires_at < now();
  if (select count(*) from device_links where user_id = me) >= 5 then raise exception 'Too many codes. Wait a few minutes and try again.'; end if;
  if (select count(*) from device_tokens where user_id = me) >= 20 then raise exception 'Unlink a device first (20 at most)'; end if;
  b := gen_random_bytes(8);
  for i in 0..7 loop code := code || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1); end loop;
  insert into device_links (code_hash, user_id) values (encode(digest(code, 'sha256'), 'hex'), me);
  return code;
end $$;
revoke execute on function public.create_device_link() from anon;

-- Service only. One use; returns the new token once.
create or replace function public.redeem_device_link(code text, device_name text, device_kind text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare l device_links; tok text; norm text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  delete from device_links where code_hash = encode(digest(norm, 'sha256'), 'hex') returning * into l;
  if l.user_id is null or l.expires_at < now() then return null; end if;
  tok := 'mdv_' || encode(gen_random_bytes(24), 'hex');
  insert into device_tokens (user_id, name, kind, token_hash, prefix)
    values (l.user_id, left(coalesce(nullif(trim(device_name), ''), 'Device'), 80),
            case when device_kind in ('extension', 'watch', 'wear', 'desktop') then device_kind else 'other' end,
            encode(digest(tok, 'sha256'), 'hex'), left(tok, 10));
  return tok;
end $$;
revoke execute on function public.redeem_device_link(text, text, text) from public, anon, authenticated;

-- ---------- Inbound webhooks (Aircall) ----------
-- The URL carries an unguessable key; the provider's own token in the body is checked too.

create table public.inbound_hooks (
  key text primary key default encode(extensions.gen_random_bytes(18), 'hex'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('aircall')),
  verify_token text,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);
alter table public.inbound_hooks enable row level security;
create policy "own inbound hooks" on public.inbound_hooks for select using (user_id = auth.uid());
create policy "make own inbound hooks" on public.inbound_hooks for insert with check (user_id = auth.uid());
create policy "remove own inbound hooks" on public.inbound_hooks for delete using (user_id = auth.uid());
revoke all on public.inbound_hooks from anon, authenticated;
grant select (key, user_id, provider, created_at), insert (provider), delete on public.inbound_hooks to authenticated;
create policy "set own inbound token" on public.inbound_hooks for update using (user_id = auth.uid()) with check (user_id = auth.uid());
grant update (verify_token) on public.inbound_hooks to authenticated;

-- The call that passed the PIN step (so /dial can't be reached without it).
alter table public.phone_links add column last_call_sid text;
