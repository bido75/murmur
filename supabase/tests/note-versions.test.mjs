// note_versions RLS: owners and teammates can read prior note snapshots, outsiders
// cannot read or write them. (Snapshots are written by the pipeline via the service
// role, so setup inserts use asService, mirroring that.)
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, asService, freshDb } from './harness.mjs';

const owner = { id: '00000000-0000-0000-0000-0000000000a1', email: 'olivia@acme.com' };
const mate = { id: '00000000-0000-0000-0000-0000000000b2', email: 'ben@acme.com' };
const outsider = { id: '00000000-0000-0000-0000-0000000000c3', email: 'eve@else.com' };
const REC = '10000000-0000-0000-0000-000000000001';

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
  for (const u of [owner, mate, outsider]) await addUser(db, u.id, u.email);
  const ws = (await rows(owner, `select create_workspace('Acme') as id`))[0].id;
  const p = (await rows(owner, `insert into projects (name, workspace_id) values ('Riverside', $1) returning id`, [ws]))[0].id;
  await rows(owner, `insert into recordings (id, title, project_id) values ($1, 'OAC', $2)`, [REC, p]);
  await asService(db, async (tx) => {
    await tx.query(`insert into summaries (recording_id, user_id, overview) values ($1, $2, 'first')`, [REC, owner.id]);
  });
  const code = (await rows(owner, `select create_invite($1, 'ben@acme.com') as code`, [ws]))[0].code;
  await rows(mate, `select accept_invite($1)`, [code]);
});

test('note versions: owner and teammate read, outsider cannot read or write', async () => {
  await asService(db, async (tx) => {
    await tx.query(`insert into note_versions (recording_id, user_id, version, summary) values ($1, $2, 1, $3)`, [REC, owner.id, JSON.stringify({ overview: 'first' })]);
  });
  assert.equal((await rows(owner, 'select * from note_versions')).length, 1);
  assert.equal((await rows(mate, 'select * from note_versions')).length, 1, 'teammate can read prior versions');
  assert.equal((await rows(outsider, 'select * from note_versions')).length, 0, 'outsider cannot read');
  assert.ok(await fails(outsider, `insert into note_versions (recording_id, user_id, version, summary) values ($1, $2, 99, '{}')`, [REC, owner.id]), 'outsider cannot write');
});

test('a versioned snapshot is preserved as a distinct row', async () => {
  await asService(db, async (tx) => {
    await tx.query(`insert into note_versions (recording_id, user_id, version, summary) values ($1, $2, 2, $3)`, [REC, owner.id, JSON.stringify({ overview: 'second' })]);
  });
  const v = (await rows(owner, 'select version, summary from note_versions order by version desc'))[0];
  assert.equal(v.version, 2);
  assert.equal(v.summary.overview, 'second');
});
