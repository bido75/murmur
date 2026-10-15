import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, asService, freshDb } from './harness.mjs';

const u = { id: '00000000-0000-0000-0000-0000000000e1', email: 'u@x.com' };
const other = { id: '00000000-0000-0000-0000-0000000000e2', email: 'o@x.com' };
let db;
const svc = async (sql, p = []) => (await asService(db, (tx) => tx.query(sql, p))).rows;
const user = async (who, sql, p = []) => (await as(db, who, (tx) => tx.query(sql, p))).rows;
const fails = async (who, sql, p = []) => { try { await as(db, who, (tx) => tx.query(sql, p)); return false; } catch { return true; } };

before(async () => {
  db = await freshDb();
  await addUser(db, u.id, u.email);
  await addUser(db, other.id, other.email);
  await svc(`insert into oauth_clients (client_id, client_name, redirect_uris) values ('c1', 'Claude', '{https://claude.ai/api/mcp/auth_callback}')`);
});

test('authorization code can be redeemed once', async () => {
  await svc(`insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, resource) values ('h1', 'c1', $1, 'https://claude.ai/api/mcp/auth_callback', 'x', 'https://app/mcp')`, [u.id]);
  assert.equal((await svc(`select * from oauth_consume_code('h1')`)).length, 1);
  assert.equal((await svc(`select * from oauth_consume_code('h1')`)).length, 0);
});

test('expired code is refused', async () => {
  await svc(`insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, resource, expires_at) values ('h2', 'c1', $1, 'r', 'x', 'res', now() - interval '1 second')`, [u.id]);
  assert.equal((await svc(`select * from oauth_consume_code('h2')`)).length, 0);
});

test('refresh token rotates once; reuse revokes the whole family', async () => {
  const fam = '30000000-0000-0000-0000-000000000001';
  await svc(`insert into oauth_tokens (token_hash, kind, client_id, user_id, resource, family, expires_at) values
    ('r1', 'refresh', 'c1', $1, 'res', $2, now() + interval '1 day'),
    ('a1', 'access', 'c1', $1, 'res', $2, now() + interval '1 hour')`, [u.id, fam]);
  assert.equal((await svc(`select * from oauth_use_refresh('r1')`)).length, 1);
  // The new pair issued after rotation, same family.
  await svc(`insert into oauth_tokens (token_hash, kind, client_id, user_id, resource, family, expires_at) values
    ('r2', 'refresh', 'c1', $1, 'res', $2, now() + interval '1 day'), ('a2', 'access', 'c1', $1, 'res', $2, now() + interval '1 hour')`, [u.id, fam]);
  // Attacker replays the old refresh token: refused, and everything in the family is gone.
  assert.equal((await svc(`select * from oauth_use_refresh('r1')`)).length, 0);
  assert.equal((await svc(`select * from oauth_tokens where family = $1`, [fam])).length, 0);
});

test('connected apps list and disconnect work for the signed-in user only', async () => {
  await svc(`insert into oauth_tokens (token_hash, kind, client_id, user_id, resource, family, expires_at) values
    ('r3', 'refresh', 'c1', $1, 'res', gen_random_uuid(), now() + interval '1 day')`, [u.id]);
  assert.deepEqual((await user(u, 'select client_name from my_connected_apps()')).map((r) => r.client_name), ['Claude']);
  assert.equal((await user(other, 'select * from my_connected_apps()')).length, 0);
  await user(other, `select disconnect_app('c1')`);
  assert.equal((await user(u, 'select * from my_connected_apps()')).length, 1, 'other user disconnected my app');
  await user(u, `select disconnect_app('c1')`);
  assert.equal((await user(u, 'select * from my_connected_apps()')).length, 0);
});

test('app users cannot touch OAuth tables or functions', async () => {
  for (const t of ['oauth_clients', 'oauth_codes', 'oauth_tokens', 'calendar_oauth_states']) {
    assert.ok(await fails(u, `select * from ${t}`), `${t} readable`);
  }
  assert.ok(await fails(u, `select * from oauth_consume_code('x')`));
  assert.ok(await fails(u, `select * from oauth_use_refresh('x')`));
});

test('calendar: refresh token never readable; links only to readable projects', async () => {
  await svc(`insert into calendar_connections (user_id, provider, account_email, refresh_token) values ($1, 'google', 'u@x.com', 'secret')`, [u.id]);
  assert.ok(await fails(u, 'select refresh_token from calendar_connections'));
  assert.deepEqual((await user(u, 'select provider, account_email from calendar_connections')), [{ provider: 'google', account_email: 'u@x.com' }]);
  assert.equal((await user(other, 'select provider from calendar_connections')).length, 0);
  assert.ok(await fails(u, 'select * from calendar_connections'), 'select * would expose the token column');
  const pid = (await user(u, `insert into projects (name) values ('Weekly sync') returning id`))[0].id;
  await user(u, `insert into calendar_links (event_key, project_id) values ('g:abc', $1)`, [pid]);
  assert.ok(await fails(other, `insert into calendar_links (event_key, project_id) values ('g:abc', $1)`, [pid]), 'linked to a project they cannot read');
});
