import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, freshDb } from './harness.mjs';

test('existing migrations apply and RLS isolates users', async () => {
  const db = await freshDb();
  const a = { id: '00000000-0000-0000-0000-00000000000a', email: 'a@x.com' };
  const b = { id: '00000000-0000-0000-0000-00000000000b', email: 'b@x.com' };
  await addUser(db, a.id, a.email);
  await addUser(db, b.id, b.email);
  await as(db, a, (tx) => tx.query(`insert into recordings (id, title) values ('10000000-0000-0000-0000-000000000001', 'A private')`));
  const seenByB = await as(db, b, (tx) => tx.query('select id from recordings'));
  assert.equal(seenByB.rows.length, 0);
  const seenByA = await as(db, a, (tx) => tx.query('select id from recordings'));
  assert.equal(seenByA.rows.length, 1);
});
