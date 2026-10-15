// Row-level security for teams, tested as real users on real Postgres.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, asService, freshDb } from './harness.mjs';

const owner = { id: '00000000-0000-0000-0000-0000000000a1', email: 'olivia@acme.com' };
const mate = { id: '00000000-0000-0000-0000-0000000000b2', email: 'ben@acme.com' };
const outsider = { id: '00000000-0000-0000-0000-0000000000c3', email: 'eve@else.com' };
const late = { id: '00000000-0000-0000-0000-0000000000d4', email: 'dan@acme.com' };

const REC_TEAM = '10000000-0000-0000-0000-000000000001';
const REC_PRIVATE = '10000000-0000-0000-0000-000000000002';
const REC_MATE = '10000000-0000-0000-0000-000000000003';

let db, ws, teamProject, personalProject;

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
  for (const u of [owner, mate, outsider, late]) await addUser(db, u.id, u.email);

  ws = (await rows(owner, `select create_workspace('Acme Builders') as id`))[0].id;
  teamProject = (await rows(owner, `insert into projects (name, workspace_id) values ('Riverside Lofts', $1) returning id`, [ws]))[0].id;
  personalProject = (await rows(owner, `insert into projects (name) values ('My 1:1s') returning id`))[0].id;

  await rows(owner, `insert into recordings (id, title, project_id) values ($1, 'Site walk', $2)`, [REC_TEAM, teamProject]);
  await rows(owner, `insert into recordings (id, title, project_id) values ($1, 'Private', $2)`, [REC_PRIVATE, personalProject]);
  await asService(db, async (tx) => {
    for (const [rid, uid] of [[REC_TEAM, owner.id], [REC_PRIVATE, owner.id]]) {
      await tx.query(`insert into transcripts (recording_id, user_id, text) values ($1, $2, 'the crane is booked for monday')`, [rid, uid]);
      await tx.query(`insert into summaries (recording_id, user_id, overview) values ($1, $2, 'notes')`, [rid, uid]);
      await tx.query(`insert into tasks (recording_id, user_id, text) values ($1, $2, 'Book crane')`, [rid, uid]);
    }
    await tx.query(`insert into storage.objects (bucket_id, name) values ('audio', $1), ('audio', $2)`, [
      `${owner.id}/${REC_TEAM}/seg-0001.m4a`,
      `${owner.id}/${REC_PRIVATE}/seg-0001.m4a`,
    ]);
  });

  const code = (await rows(owner, `select create_invite($1, 'BEN@acme.com') as code`, [ws]))[0].code;
  await rows(mate, `select accept_invite($1)`, [code]);
});

test('teammate sees the team project, its recording, transcript, notes and tasks', async () => {
  assert.deepEqual((await rows(mate, 'select name from projects')).map((r) => r.name), ['Riverside Lofts']);
  assert.deepEqual((await rows(mate, 'select id from recordings')).map((r) => r.id), [REC_TEAM]);
  assert.equal((await rows(mate, 'select * from transcripts')).length, 1);
  assert.equal((await rows(mate, 'select * from summaries')).length, 1);
  assert.equal((await rows(mate, 'select * from tasks')).length, 1);
});

test("teammate never sees the owner's personal project or its recording", async () => {
  assert.equal((await rows(mate, 'select * from recordings where id = $1', [REC_PRIVATE])).length, 0);
  assert.equal((await rows(mate, 'select * from projects where id = $1', [personalProject])).length, 0);
});

test('outsider sees nothing at all', async () => {
  for (const t of ['projects', 'recordings', 'transcripts', 'summaries', 'tasks', 'workspaces', 'workspace_members', 'workspace_invites']) {
    assert.equal((await rows(outsider, `select * from ${t}`)).length, 0, `outsider can see ${t}`);
  }
  assert.equal((await rows(outsider, `select * from storage.objects`)).length, 0);
});

test('teammate can play team audio but not private audio', async () => {
  const names = (await rows(mate, `select name from storage.objects`)).map((r) => r.name);
  assert.deepEqual(names, [`${owner.id}/${REC_TEAM}/seg-0001.m4a`]);
});

test('search finds team transcripts for teammates, nothing for outsiders', async () => {
  assert.deepEqual((await rows(mate, `select recording_id from search_transcripts('crane')`)).map((r) => r.recording_id), [REC_TEAM]);
  assert.equal((await rows(outsider, `select * from search_transcripts('crane')`)).length, 0);
  assert.equal((await rows(owner, `select * from search_transcripts('crane')`)).length, 2);
});

test('teammate can tick team tasks but not edit or delete the recording', async () => {
  const updated = await rows(mate, `update tasks set status = 'done' where recording_id = $1 returning id`, [REC_TEAM]);
  assert.equal(updated.length, 1);
  assert.equal((await rows(mate, `update recordings set title = 'hijacked' where id = $1 returning id`, [REC_TEAM])).length, 0);
  assert.equal((await rows(mate, `delete from recordings where id = $1 returning id`, [REC_TEAM])).length, 0);
  assert.equal((await rows(owner, `select title from recordings where id = $1`, [REC_TEAM]))[0].title, 'Site walk');
});

test('teammate can add their own recording to the team project; outsider cannot', async () => {
  await rows(mate, `insert into recordings (id, title, project_id) values ($1, 'Ben call', $2)`, [REC_MATE, teamProject]);
  assert.equal((await rows(owner, `select * from recordings where id = $1`, [REC_MATE])).length, 1);
  assert.ok(await fails(outsider, `insert into recordings (title, project_id) values ('sneak', $1)`, [teamProject]));
  assert.ok(await fails(outsider, `insert into projects (name, workspace_id) values ('sneak', $1)`, [ws]));
});

test('outsider cannot read or tamper through task updates', async () => {
  assert.equal((await rows(outsider, `update tasks set status = 'dismissed' returning id`)).length, 0);
});

test('invites: wrong email, reuse and bad codes are refused', async () => {
  const code = (await rows(owner, `select create_invite($1, 'dan@acme.com') as code`, [ws]))[0].code;
  assert.match(code, /^[A-Z2-9]{10}$/);
  assert.ok(await fails(outsider, `select accept_invite($1)`, [code]), 'wrong email accepted');
  await rows(late, `select accept_invite($1)`, [code.toLowerCase()]);
  assert.ok(await fails(late, `select accept_invite($1)`, [code]), 'reuse accepted');
  assert.ok(await fails(outsider, `select accept_invite('NOTACODE00')`));
  assert.equal((await rows(late, 'select * from recordings where id = $1', [REC_TEAM])).length, 1);
});

test('only admins invite; members cannot see invite codes', async () => {
  assert.ok(await fails(mate, `select create_invite($1, 'x@acme.com')`, [ws]));
  assert.equal((await rows(mate, 'select * from workspace_invites')).length, 0);
  assert.ok((await rows(owner, 'select * from workspace_invites')).length >= 1);
});

test('last owner cannot leave; a member can leave and loses access', async () => {
  assert.ok(await fails(owner, `select remove_member($1, $2)`, [ws, owner.id]));
  await rows(late, `select remove_member($1, $2)`, [ws, late.id]);
  assert.equal((await rows(late, 'select * from recordings')).length, 0);
});

test('member cannot remove someone else or promote themselves', async () => {
  assert.ok(await fails(mate, `select remove_member($1, $2)`, [ws, owner.id]));
  assert.ok(await fails(mate, `select set_member_role($1, $2, 'owner')`, [ws, mate.id]));
});

test('API tokens: hash only, shown once, never readable', async () => {
  const tok = (await rows(owner, `select create_api_token('Claude') as t`))[0].t;
  assert.match(tok, /^mur_[0-9a-f]{48}$/);
  const listed = await rows(owner, 'select id, name, prefix from api_tokens');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].prefix, tok.slice(0, 10));
  assert.ok(await fails(owner, 'select token_hash from api_tokens'), 'hash readable by app');
  assert.equal((await rows(mate, 'select id from api_tokens')).length, 0);
  const hash = (await asService(db, (tx) => tx.query(`select token_hash from api_tokens`))).rows[0].token_hash;
  const { createHash } = await import('node:crypto');
  assert.equal(hash, createHash('sha256').update(tok).digest('hex'));
});

test('can_read_recording works for an explicit user (used by the MCP server)', async () => {
  const r = await asService(db, (tx) =>
    tx.query(`select can_read_recording($1, $2) as mate, can_read_recording($3, $2) as priv, can_read_recording($1, $4) as out`, [REC_TEAM, mate.id, REC_PRIVATE, outsider.id]),
  );
  assert.deepEqual(r.rows[0], { mate: true, priv: false, out: false });
});

test('integration tokens stay unreadable', async () => {
  await asService(db, (tx) => tx.query(`insert into integrations (user_id, provider, secret) values ($1, 'linear', 'lin_secret')`, [owner.id]));
  assert.ok(await fails(owner, 'select secret from integrations'));
  assert.equal((await rows(owner, 'select provider from integrations')).length, 1);
});

test('MCP scope functions match the app rules and are service-only', async () => {
  const scope = async (u) => (await asService(db, (tx) => tx.query('select id from readable_recordings($1)', [u.id]))).rows.map((r) => r.id).sort();
  const viaRls = async (u) => (await rows(u, 'select id from recordings')).map((r) => r.id).sort();
  for (const u of [owner, mate, outsider, late]) assert.deepEqual(await scope(u), await viaRls(u), `scope mismatch for ${u.email}`);
  const projects = (await asService(db, (tx) => tx.query('select name, team from readable_projects($1)', [mate.id]))).rows;
  assert.deepEqual(projects, [{ name: 'Riverside Lofts', team: 'Acme Builders' }]);
  assert.ok(await fails(mate, 'select * from readable_recordings($1)', [owner.id]), 'app users must not call scope functions');
});

test("signed-in users can't probe other users' access through helper functions", async () => {
  const r = await rows(mate, 'select can_read_recording($1, $2) as v, is_member($3, $4) as m', [REC_PRIVATE, owner.id, ws, outsider.id]);
  // Checked as the caller (mate): mate can't read the private recording, but is a member.
  assert.deepEqual(r[0], { v: false, m: true });
});
