// Plans and minutes: only the server writes them, and only you can read your own.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, asService, freshDb } from './harness.mjs';

const a = { id: '00000000-0000-0000-0000-0000000000a1', email: 'a@acme.com' };
const b = { id: '00000000-0000-0000-0000-0000000000b2', email: 'b@acme.com' };
const c = { id: '00000000-0000-0000-0000-0000000000c3', email: 'c@else.com' };
let db, ws;

const rows = async (u, sql, p = []) => (await as(db, u, (tx) => tx.query(sql, p))).rows;
const fails = async (u, sql, p = []) => {
  try {
    await as(db, u, (tx) => tx.query(sql, p));
    return false;
  } catch {
    return true;
  }
};
const svc = async (sql, p = []) => (await asService(db, (tx) => tx.query(sql, p))).rows;

before(async () => {
  db = await freshDb();
  for (const u of [a, b, c]) await addUser(db, u.id, u.email);
  ws = (await rows(a, `select create_workspace('Acme') as id`))[0].id;
  await svc(`insert into workspace_members (workspace_id, user_id, role, email) values ($1, $2, 'member', $3)`, [ws, b.id, b.email]);
  await svc(
    `insert into entitlements (user_id, plan, period, minutes_included, minutes_used, current_period_end, provider)
     values ($1, 'free', 'monthly', 60, 0, now() + interval '1 month', 'none')`,
    [a.id],
  );
});

test('you can read your own plan; a teammate and an outsider cannot', async () => {
  const mine = await rows(a, 'select plan, minutes_included from entitlements');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].plan, 'free');
  assert.equal(mine[0].minutes_included, 60);
  // A teammate in the same workspace still gets nothing.
  assert.equal((await rows(b, 'select * from entitlements')).length, 0);
  assert.equal((await rows(c, 'select * from entitlements')).length, 0);
});

test('the app cannot write a plan, not even its own', async () => {
  assert.ok(await fails(a, `insert into entitlements (user_id) values ($1)`, [a.id]), 'no free plan either');
  assert.ok(await fails(a, `insert into entitlements (user_id) values ($1)`, [b.id]), "not someone else's");
  assert.ok(await fails(a, `update entitlements set plan = 'paid' where user_id = $1`, [a.id]), 'no upgrading yourself');
  assert.ok(await fails(a, `update entitlements set minutes_used = 0 where user_id = $1`, [a.id]), 'no wiping your own minutes');
  assert.ok(await fails(a, `delete from entitlements where user_id = $1`, [a.id]));
  assert.ok(await fails(b, `insert into entitlements (user_id) values ($1)`, [a.id]), "an outsider cannot write someone else's");
  // The server can.
  await svc(`update entitlements set plan = 'paid', provider = 'stripe' where user_id = $1`, [a.id]);
  assert.equal((await rows(a, 'select plan from entitlements'))[0].plan, 'paid');
  await svc(`update entitlements set plan = 'free', provider = 'none' where user_id = $1`, [a.id]);
});

test('minutes come from the recordings, and only the server can count them', async () => {
  await svc(`insert into recordings (user_id, title, status, duration_ms) values ($1, 'Site walk', 'ready', 1500000)`, [a.id]);
  await svc(`insert into recordings (user_id, title, status, duration_ms, created_at) values ($1, 'Last month', 'ready', 900000, now() - interval '2 months')`, [a.id]);
  assert.ok(await fails(a, `select sync_entitlement_usage($1)`, [a.id]), 'server only');
  const used = await svc(`select sync_entitlement_usage($1) as used`, [a.id]);
  assert.equal(used[0].used, 25, '25 minutes of audio in this period');
  assert.equal((await rows(a, 'select minutes_used from entitlements'))[0].minutes_used, 25);
});

test('billing events are server only, and the same event cannot be taken twice', async () => {
  assert.ok(await fails(a, `insert into billing_events (provider, event_id, event_type, occurred_at) values ('stripe', 'evt_1', 'customer.subscription.created', now())`));
  assert.ok(await fails(a, 'select * from billing_events'), 'the app cannot read the ledger');
  await svc(`insert into billing_events (provider, event_id, event_type, occurred_at) values ('stripe', 'evt_1', 'customer.subscription.created', now())`);
  assert.ok(await fails(a, `insert into billing_events (provider, event_id, event_type, occurred_at) values ('stripe', 'evt_1', 'customer.subscription.created', now())`), 'the same event twice');
});

test('the paywall is switched on by the server, not by the app', async () => {
  assert.ok(await fails(a, `select feature_enabled('billing')`), 'server only');
  assert.ok(await fails(a, `update app_features set enabled = true where name = 'billing'`));
  assert.equal((await svc(`select feature_enabled('billing') as on`))[0].on, false, 'off until it is set up');
  await svc(`update app_features set enabled = true where name = 'billing'`);
  assert.equal((await svc(`select feature_enabled('billing') as on`))[0].on, true);
});
