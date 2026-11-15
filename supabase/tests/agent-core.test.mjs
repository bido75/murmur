// Agent Core RLS: runs, messages and steps are owner-only; an outsider cannot read or
// write them. Mirrors knowledge.test.mjs.
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

test('owner can build and read a run with a message and step', async () => {
  const rid = (await rows(owner, `insert into agent_runs (user_id, intent, status) values ($1, 'general', 'running') returning id`, [owner.id]))[0].id;
  await rows(owner, `insert into agent_messages (run_id, user_id, role, content) values ($1, $2, 'user', 'hi')`, [rid, owner.id]);
  await rows(owner, `insert into agent_steps (run_id, step_index, tool, status) values ($1, 0, 'projects.list', 'succeeded')`, [rid]);

  assert.equal((await rows(owner, 'select * from agent_runs')).length, 1);
  assert.equal((await rows(owner, 'select * from agent_messages')).length, 1);
  assert.equal((await rows(owner, 'select * from agent_steps')).length, 1);

  assert.equal((await rows(outsider, 'select * from agent_runs')).length, 0, 'outsider cannot read runs');
  assert.equal((await rows(outsider, 'select * from agent_messages')).length, 0);
  assert.equal((await rows(outsider, 'select * from agent_steps')).length, 0);
});

test('outsider cannot insert a run, or a step/message under another user\'s run', async () => {
  assert.ok(await fails(outsider, `insert into agent_runs (user_id, intent) values ($1, 'general')`, [owner.id]), 'outsider cannot write a run');
  const rid = (await rows(owner, `insert into agent_runs (user_id, intent, status) values ($1, 'general', 'running') returning id`, [owner.id]))[0].id;
  assert.ok(await fails(outsider, `insert into agent_messages (run_id, user_id, role, content) values ($1, $2, 'user', 'x')`, [rid, owner.id]), 'outsider cannot write a message');
  assert.ok(await fails(outsider, `insert into agent_steps (run_id, step_index, tool, status) values ($1, 0, 'projects.list', 'succeeded')`, [rid]), 'outsider cannot write a step');
});
