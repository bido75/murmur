-- Outbound webhook URLs must not point at the server itself, the cloud metadata
-- service, or anything else on a private network (SSRF). This is the database-side
-- half of the guard; the function that delivers resolves the host and checks again.

create or replace function public.webhook_url_public(url text)
returns boolean
language plpgsql immutable as $$
declare
  host text;
begin
  if url is null or url !~ '^https://' then
    return false;
  end if;
  host := lower(split_part(substring(url from 9), '/', 1)); -- strip https:// then host before any path
  host := rtrim(split_part(host, ':', 1), ']');              -- drop any :port and a trailing ']'
  host := ltrim(host, '[');
  if host = '' then
    return false;
  end if;
  -- Literal private / loopback / link-local / reserved IPv4.
  if host ~ '^127\.' or host ~ '^10\.' or host ~ '^0\.'
     or host ~ '^192\.168\.' or host ~ '^169\.254\.'
     or host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.'
     or host ~ '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.'
     or host ~ '^192\.0\.' or host ~ '^198\.(18|19)\.'
     or host ~ '^22[4-9]\.' or host ~ '^2[3-5][0-9]\.'
  then
    return false;
  end if;
  -- Internal / local names and single-label hosts cannot be public.
  if host = 'localhost'
     or host like '%.localhost'
     or host like '%.local'
     or host like '%.internal'
     or host not like '%.%'
  then
    return false;
  end if;
  return true;
end $$;

alter table public.webhooks drop constraint if exists webhooks_url_public;
-- NOT VALID: adding the constraint validates existing rows and would abort on any
-- pre-existing private URL. Add it unvalidated, clean up violating rows, then
-- validate explicitly (see below).
alter table public.webhooks add constraint webhooks_url_public check (webhook_url_public(url)) not valid;