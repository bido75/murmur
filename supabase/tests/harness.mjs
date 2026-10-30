// Runs the real migrations on an in-process Postgres (PGlite) with small stand-ins for
// Supabase's auth and storage schemas, so row-level security can be tested as real users.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUBS = `
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'email', current_setting('request.jwt.claim.email', true)) $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

export async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUBS);
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
  return db;
}

export async function addUser(db, id, email) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
}

/** Run queries as a signed-in user (RLS applies). */
export async function as(db, user, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.email', $2, true)`, [user.id, user.email]);
    return fn(tx);
  });
}

/** Run as the service role (Edge Functions' admin client). */
export async function asService(db, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`);
    return fn(tx);
  });
}
