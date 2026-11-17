// Knowledge Graph RLS: personal entities/assertions/decisions are owner-only; an
// outsider cannot read or write them.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, freshDb } from './harness.mjs';

const owner = { id: '00000000-0000-0000-0000-0000000000a1', email: 'olivia@acme.com' };
const outsider = { id: '00000000-0000-0000-0000-0000000000c3', email: 'eve@else.com' };

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
  for (const u of [owner, outsider]) await addUser(db, u.id, u.email);
});

test('owner builds and reads the graph; outsider is fully blocked', async () => {
  const eid = (await rows(owner, `insert into knowledge_entities (user_id, kind, name) values ($1, 'person', 'Maya') returning id`, [owner.id]))[0].id;
  await rows(owner, `insert into knowledge_aliases (entity_id, alias) values ($1, 'M')`, [eid]);
  await rows(owner, `insert into knowledge_assertions (user_id, subject_id, predicate, value) values ($1, $2, 'works_on', 'Riverside')`, [owner.id, eid]);
  await rows(owner, `insert into decision_history (user_id, text, status) values ($1, 'Use Hilti anchors', 'accepted')`, [owner.id]);

  assert.equal((await rows(owner, 'select * from knowledge_entities')).length, 1);
  assert.equal((await rows(owner, 'select * from knowledge_assertions')).length, 1);
  assert.equal((await rows(owner, 'select * from decision_history')).length, 1);

  assert.equal((await rows(outsider, 'select * from knowledge_entities')).length, 0, 'outsider cannot read entities');
  assert.equal((await rows(outsider, 'select * from knowledge_assertions')).length, 0);
  assert.equal((await rows(outsider, 'select * from decision_history')).length, 0);

  assert.ok(await fails(outsider, `insert into knowledge_entities (user_id, kind, name) values ($1, 'person', 'spam')`, [owner.id]), 'outsider cannot write');
  assert.ok(await fails(outsider, `insert into knowledge_assertions (user_id, subject_id, predicate) values ($1, $2, 'spam')`, [owner.id, eid]), 'outsider cannot assert');
});

test('aliases cannot point at an entity the user does not own', async () => {
  const eid = (await rows(owner, `insert into knowledge_entities (user_id, kind, name) values ($1, 'topic', 'concrete') returning id`, [owner.id]))[0].id;
  assert.ok(await fails(outsider, `insert into knowledge_aliases (entity_id, alias) values ($1, 'x')`, [eid]), 'outsider cannot alias another user\'s entity');
});
