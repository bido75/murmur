-- Enforce "SSO required" at the auth server, not just in the app.
-- Supabase calls this before issuing any access token (sign-in and every refresh). For a verified
-- domain whose team requires single sign-on, a session that didn't start with SSO gets no token:
-- email codes, magic links and other methods are refused, and older non-SSO sessions end at their
-- next refresh. Turn it on in Dashboard → Authentication → Hooks → Customize Access Token
-- (Postgres function public.custom_access_token_hook), or in config.toml:
--   [auth.hook.custom_access_token]
--   enabled = true
--   uri = "pg-functions://postgres/public/custom_access_token_hook"

create or replace function public.sso_required_for(email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_domains d
    where d.domain = lower(split_part(coalesce(email, ''), '@', 2))
      and d.verified_at is not null and d.sso_provider_id is not null and d.sso_required
  )
$$;
revoke execute on function public.sso_required_for(text) from public, anon, authenticated;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  email text := coalesce(event -> 'claims' ->> 'email', (select u.email from auth.users u where u.id = (event ->> 'user_id')::uuid));
  amr jsonb := coalesce(event -> 'claims' -> 'amr', '[]'::jsonb);
begin
  if sso_required_for(email) and not exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(amr) = 'array' then amr else '[]'::jsonb end) a
    where a ->> 'method' like 'sso/%'
  ) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Your company requires single sign-on. Choose "Continue with single sign-on" to sign in.'));
  end if;
  return event;
end $$;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end $$;

