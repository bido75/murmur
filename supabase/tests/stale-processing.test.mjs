// The stale-processing sweep: a recording whose pipeline job died must not sit
// in a transient state forever. fail_stale_processing() (called daily by the
// retention cron) fails recordings stuck in uploading/transcribing/summarizing
// for over two hours, and leaves recent ones alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, addUser } from './harness.mjs';

const U1 = '11111111-1111-1111-1111-111111111111';

let db;

test('setup', async () => {
  db = await freshDb();
  await addUser(db, U1, 'a@x.test');
});

async function seedRecording(id, status, ageHours) {
  await db.query(
    `insert into public.recordings (id, user_id, title, status, updated_at)
     values ($1, $2, 'r', $3, now() - ($4 || ' hours')::interval)`,
    [id, U1, status, ageHours],
  );
}

test('a recording stuck in a transient state for over two hours is failed with a clear error', async () => {
  await seedRecording('33333333-3333-3333-3333-333333333333', 'transcribing', 3);
  const r = await db.query('select public.fail_stale_processing(200) as moved');
  assert.equal(r.rows[0].moved, 1);
  const row = await db.query('select status, error from public.recordings where id = $1', ['33333333-3333-3333-3333-333333333333']);
  assert.equal(row.rows[0].status, 'failed');
  assert.match(row.rows[0].error, /did not finish/i);
});

test('recent transient recordings are left alone (a long recording is still working)', async () => {
  await seedRecording('44444444-4444-4444-4444-444444444444', 'transcribing', 1);
  await seedRecording('55555555-5555-5555-5555-555555555555', 'uploading', 1.5);
  await seedRecording('66666666-6666-6666-6666-666666666666', 'summarizing', 2.5);
  const r = await db.query('select public.fail_stale_processing(200) as moved');
  assert.equal(r.rows[0].moved, 1, 'only the 2.5-hour-old summarizing recording is stale');
  const states = await db.query('select id, status from public.recordings where id in ($1,$2,$3) order by id', [
    '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666',
  ]);
  assert.deepEqual(states.rows.map((x) => x.status), ['transcribing', 'uploading', 'failed']);
});

test('finished and failed recordings are never touched', async () => {
  await seedRecording('77777777-7777-7777-7777-777777777777', 'ready', 24);
  await seedRecording('88888888-8888-8888-8888-888888888888', 'failed', 24);
  await seedRecording('99999999-9999-9999-9999-999999999999', 'recording', 24);
  const r = await db.query('select public.fail_stale_processing(200) as moved');
  assert.equal(r.rows[0].moved, 0);
  const states = await db.query('select status from public.recordings where id in ($1,$2,$3) order by id', [
    '77777777-7777-7777-7777-777777777777', '88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999',
  ]);
  assert.deepEqual(states.rows.map((x) => x.status), ['ready', 'failed', 'recording']);
});
