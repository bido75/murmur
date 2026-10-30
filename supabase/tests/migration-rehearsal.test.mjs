// Migration rehearsal: proves the two new migrations deploy safely on a copy of
// the existing production shape — legacy data is seeded BEFORE they run (the way
// a real deployment meets the database), then the migrations are applied in
// order and everything is re-checked.
//
// The SSRF migration is the risky one: its constraint must NOT abort deployment
// when pre-existing webhook rows hold private URLs (that is why it is NOT VALID).
// The rehearsal also proves the documented cleanup path: fix the violating URLs,
// then validate the constraint explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUBS as stubs } from './harness.mjs';

const NEW_MIGRATIONS = ['20261025010000_user_prefs.sql', '20261025020000_webhook_ssrf.sql'];
const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const before = all.filter((f) => !NEW_MIGRATIONS.includes(f));

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const REC1 = '33333333-3333-3333-3333-333333333333';

let db;

async function apply(files) {
  for (const f of files) {
    try {
      await db.exec(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
}

async function asUser(id, fn) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id]);
    return fn(tx);
  });
}

test('setup: production shape before this branch (all migrations except the two new ones)', async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(stubs);
  await apply(before);
});

test('seed: sanitized legacy production data, including webhook rows with private URLs', async () => {
  await db.query('insert into auth.users (id, email) values ($1,$2), ($3,$4)', [U1, 'a@x.test', U2, 'b@x.test']);
  await db.query(
    `insert into public.projects (id, user_id, name) values ($1, $2, 'Legacy project')`,
    ['44444444-4444-4444-4444-444444444444', U1],
  );
  await db.query(
    `insert into public.recordings (id, user_id, project_id, title, status, duration_ms)
     values ($1, $2, $3, 'Legacy recording', 'ready', 60000)`,
    [REC1, U1, '44444444-4444-4444-4444-444444444444'],
  );
  await db.query(
    `insert into public.transcripts (recording_id, user_id, text) values ($1, $2, 'legacy words')`,
    [REC1, U1],
  );
  await db.query(
    `insert into public.summaries (recording_id, user_id, overview, key_points)
     values ($1, $2, 'legacy overview', '["k"]'::jsonb)`,
    [REC1, U1],
  );
  await db.query(
    `insert into public.tasks (recording_id, user_id, text) values ($1, $2, 'legacy task')`,
    [REC1, U1],
  );
  // Legacy webhook configuration: a private-LAN URL and the cloud metadata URL
  // were accepted before the SSRF guard existed. They must survive deployment.
  await db.query(
    `insert into public.webhooks (user_id, url) values
       ($1, 'https://192.168.1.50/hook'),
       ($1, 'https://169.254.169.254/latest/meta-data'),
       ($1, 'https://hooks.example.com/murmur')`,
    [U1],
  );
  await db.query(
    `insert into public.integrations (user_id, provider, secret) values ($1, 'slack', 'stored-server-side')`,
    [U1],
  );
  await db.query(
    `insert into public.workspaces (id, name, created_by) values ($1, 'Legacy team', $2)`,
    ['55555555-5555-5555-5555-555555555555', U1],
  );
  await db.query(
    `insert into public.workspace_members (workspace_id, user_id, role, email) values ($1, $2, 'member', 'b@x.test')`,
    ['55555555-5555-5555-5555-555555555555', U2],
  );
});

test('deploy: the two new migrations apply in order without aborting', async () => {
  await apply(NEW_MIGRATIONS);
});

test('legacy data is preserved (nothing rewritten or dropped)', async () => {
  const r = await db.query(
    `select
       (select count(*) from public.recordings) recordings,
       (select count(*) from public.transcripts) transcripts,
       (select count(*) from public.summaries) summaries,
       (select count(*) from public.tasks) tasks,
       (select count(*) from public.webhooks) webhooks,
       (select count(*) from public.integrations) integrations,
       (select count(*) from public.workspaces) workspaces,
       (select count(*) from public.workspace_members) members`,
  );
  assert.deepEqual(r.rows[0], {
    recordings: 1, transcripts: 1, summaries: 1, tasks: 1,
    webhooks: 3, integrations: 1, workspaces: 1, members: 1,
  });
  const rec = await db.query('select title, status from public.recordings where id = $1', [REC1]);
  assert.equal(rec.rows[0].title, 'Legacy recording');
});

test('NOT VALID semantics: pre-existing private URLs survive deployment untouched, unvalidated', async () => {
  const rows = await db.query(
    `select url, webhook_url_public(url) as ok from public.webhooks order by url`,
  );
  const byUrl = Object.fromEntries(rows.rows.map((r) => [r.url, r.ok]));
  assert.equal(byUrl['https://192.168.1.50/hook'], false, 'legacy LAN webhook still present, still private');
  assert.equal(byUrl['https://169.254.169.254/latest/meta-data'], false, 'legacy metadata webhook still present');
  assert.equal(byUrl['https://hooks.example.com/murmur'], true);
  const c = await db.query(
    `select convalidated from pg_constraint where conname = 'webhooks_url_public'`,
  );
  assert.equal(c.rows[0].convalidated, false, 'the constraint is deliberately not yet validated');
});

test('the violating rows are enumerable for the operator (cleanup list)', async () => {
  const r = await db.query(
    `select url from public.webhooks where not webhook_url_public(url) order by url`,
  );
  assert.deepEqual(
    r.rows.map((x) => x.url),
    ['https://169.254.169.254/latest/meta-data', 'https://192.168.1.50/hook'],
  );
});

test('new rows are checked: a private URL cannot be inserted, a public one can', async () => {
  await assert.rejects(
    () => db.query(`insert into public.webhooks (user_id, url) values ($1, 'https://10.0.0.9/hook')`, [U1]),
    /webhooks_url_public|check/,
  );
  await assert.rejects(
    () => db.query(`insert into public.webhooks (user_id, url) values ($1, 'https://kong:8000/hook')`, [U1]),
    /webhooks_url_public|check/,
  );
  await db.query(`insert into public.webhooks (user_id, url) values ($1, 'https://hooks.example.com/new')`, [U1]);
});

test('an UPDATE also re-checks the URL: a legacy private webhook is frozen until fixed', async () => {
  await assert.rejects(
    () => db.query(`update public.webhooks set active = false where url = 'https://192.168.1.50/hook'`),
    /webhooks_url_public|check/,
    'the constraint fires on update even though it did not validate existing rows',
  );
});

test('the documented cleanup path works: fix the URLs, then validate the constraint', async () => {
  await db.query(`update public.webhooks set url = 'https://hooks.example.com/moved' where url = 'https://192.168.1.50/hook'`);
  await db.query(`update public.webhooks set url = 'https://hooks.example.com/moved2' where url = 'https://169.254.169.254/latest/meta-data'`);
  await db.exec(`alter table public.webhooks validate constraint webhooks_url_public`);
  const c = await db.query(`select convalidated from pg_constraint where conname = 'webhooks_url_public'`);
  assert.equal(c.rows[0].convalidated, true);
  const bad = await db.query(`select count(*)::int as n from public.webhooks where not webhook_url_public(url)`);
  assert.equal(bad.rows[0].n, 0);
});

test('RLS still holds after the migrations (an outsider cannot read legacy data)', async () => {
  const recs = await asUser(U2, (tx) => tx.query('select count(*)::int as n from public.recordings'));
  assert.equal(recs.rows[0].n, 0, 'user 2 sees none of user 1 recordings');
  const hooks = await asUser(U2, (tx) => tx.query('select count(*)::int as n from public.webhooks'));
  assert.equal(hooks.rows[0].n, 0, 'user 2 sees none of user 1 webhooks');
  const own = await asUser(U1, (tx) => tx.query('select count(*)::int as n from public.recordings'));
  assert.equal(own.rows[0].n, 1, 'the owner still sees their recording');
});

test('all constraints (FK, PK, unique, check) are validated after the cleanup step', async () => {
  const r = await db.query(
    `select count(*)::int as broken
       from pg_constraint
      where not convalidated and connamespace = 'public'::regnamespace`,
  );
  assert.equal(r.rows[0].broken, 0);
});
