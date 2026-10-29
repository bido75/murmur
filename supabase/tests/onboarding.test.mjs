// Onboarding state and events are private to the user: a stranger can't read or
// change them, and events are append-only history.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, freshDb } from './harness.mjs';

const a = { id: '00000000-0000-0000-0000-0000000000a1', email: 'ada@acme.com' };
const b = { id: '00000000-0000-0000-0000-0000000000b2', email: 'ben@acme.com' };

let db;
const rows = async (user, sql, params = []) => (await as(db, user, (tx) => tx.query(sql, params))).rows;
const fails = async (user, sql, params = []) => {
  try {
    await as(db, user, (tx) => tx.query(sql, params));
    return false;
  } catch {
    return true;
  }
};

before(async () => {
  db = await freshDb();
  for (const u of [a, b]) await addUser(db, u.id, u.email);
});

test('a user can create and read their own onboarding row', async () => {
  await rows(a, `insert into user_onboarding (user_id) values ($1)`, [a.id]);
  const mine = await rows(a, `select user_id, tour_version_seen, checklist_hidden from user_onboarding where user_id = $1`, [a.id]);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].tour_version_seen, 0);
  assert.equal(mine[0].checklist_hidden, false);
});

test('nobody else can read or change another user\'s onboarding row', async () => {
  // Ben sees no rows at all, including Ada's.
  const theirs = await rows(b, `select * from user_onboarding`);
  assert.equal(theirs.length, 0);
  // RLS filters UPDATE/DELETE silently: Ben's statements match zero rows, so
  // Ada's row survives untouched. The WITH CHECK insert, however, throws.
  await rows(b, `update user_onboarding set tour_version_seen = 9 where user_id = $1`, [a.id]);
  await rows(b, `delete from user_onboarding where user_id = $1`, [a.id]);
  const still = await rows(a, `select tour_version_seen from user_onboarding where user_id = $1`, [a.id]);
  assert.equal(still.length, 1);
  assert.equal(still[0].tour_version_seen, 0);
  assert.equal(await fails(b, `insert into user_onboarding (user_id) values ($1)`, [a.id]), true);
});

test('a user can update their own onboarding row', async () => {
  await rows(a, `update user_onboarding set tour_version_seen = 1, tour_completed_at = now(), tips_seen = '{record_started}' where user_id = $1`, [a.id]);
  const mine = await rows(a, `select tour_version_seen, tips_seen from user_onboarding where user_id = $1`, [a.id]);
  assert.equal(mine[0].tour_version_seen, 1);
  assert.deepEqual(mine[0].tips_seen, ['record_started']);
});

test('events are append-only and private to the user', async () => {
  await rows(a, `insert into onboarding_events (user_id, event, step) values ($1, 'tour_started', null)`, [a.id]);
  await rows(a, `insert into onboarding_events (user_id, event, step) values ($1, 'step_viewed', 2)`, [a.id]);
  const mine = await rows(a, `select event, step from onboarding_events where user_id = $1 order by at`, [a.id]);
  assert.deepEqual(mine.map((r) => r.event), ['tour_started', 'step_viewed']);

  // Ben can't see or touch Ada's events.
  assert.equal((await rows(b, `select * from onboarding_events where user_id = $1`, [a.id])).length, 0);
  assert.equal(await fails(b, `insert into onboarding_events (user_id, event) values ($1, 'spoof')`, [a.id]), true);

  // History can't be rewritten or erased: without UPDATE/DELETE policies these
  // statements affect zero rows (RLS filters silently), so the log survives.
  await rows(a, `update onboarding_events set event = 'rewritten' where user_id = $1`, [a.id]);
  await rows(a, `delete from onboarding_events where user_id = $1`, [a.id]);
  const after = await rows(a, `select event from onboarding_events where user_id = $1 order by at`, [a.id]);
  assert.deepEqual(after.map((r) => r.event), ['tour_started', 'step_viewed']);
});

test('anon (not signed in) can do nothing', async () => {
  // RLS filters rows for anon rather than erroring: empty is the right outcome.
  const ob = await db.transaction(async (tx) => {
    await tx.exec(`set local role anon`);
    return (await tx.query(`select * from user_onboarding`)).rows.length;
  });
  assert.equal(ob, 0);
  const ev = await db.transaction(async (tx) => {
    await tx.exec(`set local role anon`);
    return (await tx.query(`select * from onboarding_events`)).rows.length;
  });
  assert.equal(ev, 0);
  // Writing as anon is rejected by the WITH CHECK (auth.uid() = user_id) policy.
  const rejected = await db.transaction(async (tx) => {
    await tx.exec(`set local role anon`);
    try {
      await tx.query(`insert into onboarding_events (user_id, event) values ($1, 'x')`, [a.id]);
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
});
