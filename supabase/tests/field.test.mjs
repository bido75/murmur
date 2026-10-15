// Photos, site log, vocabulary and Procore columns: row-level security as real users.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, asService, freshDb } from './harness.mjs';

const owner = { id: '00000000-0000-0000-0000-0000000000a1', email: 'olivia@acme.com' };
const mate = { id: '00000000-0000-0000-0000-0000000000b2', email: 'ben@acme.com' };
const outsider = { id: '00000000-0000-0000-0000-0000000000c3', email: 'eve@else.com' };

const REC_TEAM = '10000000-0000-0000-0000-000000000001';
const REC_PRIVATE = '10000000-0000-0000-0000-000000000002';
const P1 = '20000000-0000-0000-0000-000000000001';
const P2 = '20000000-0000-0000-0000-000000000002';

let db, teamProject;
const rows = async (user, sql, params = []) => (await as(db, user, (tx) => tx.query(sql, params))).rows;
const fails = async (user, sql, params = []) => {
  try {
    await as(db, user, (tx) => tx.query(sql, params));
    return false;
  } catch {
    return true;
  }
};
const photoPath = (uid, rid, pid) => `${uid}/${rid}/${pid}.jpg`;

before(async () => {
  db = await freshDb();
  for (const u of [owner, mate, outsider]) await addUser(db, u.id, u.email);
  const ws = (await rows(owner, `select create_workspace('Acme Builders') as id`))[0].id;
  teamProject = (await rows(owner, `insert into projects (name, workspace_id, vocabulary) values ('Riverside Lofts', $1, '{Hilti,"level 3"}') returning id`, [ws]))[0].id;
  const personal = (await rows(owner, `insert into projects (name) values ('Home reno') returning id`))[0].id;
  await rows(owner, `insert into recordings (id, title, project_id, template) values ($1, 'Site walk', $2, 'site_walk')`, [REC_TEAM, teamProject]);
  await rows(owner, `insert into recordings (id, title, project_id) values ($1, 'Private', $2)`, [REC_PRIVATE, personal]);
  const code = (await rows(owner, `select create_invite($1, 'ben@acme.com') as code`, [ws]))[0].code;
  await rows(mate, `select accept_invite($1)`, [code]);
});

test('owner adds a photo to their recording, in their own folder', async () => {
  await rows(owner, `insert into recording_photos (id, recording_id, storage_path, taken_ms) values ($1, $2, $3, 61000)`, [P1, REC_TEAM, photoPath(owner.id, REC_TEAM, P1)]);
  await rows(owner, `insert into recording_photos (id, recording_id, storage_path) values ($1, $2, $3)`, [P2, REC_PRIVATE, photoPath(owner.id, REC_PRIVATE, P2)]);
  await rows(owner, `insert into storage.objects (bucket_id, name) values ('photos', $1), ('photos', $2)`, [
    photoPath(owner.id, REC_TEAM, P1),
    photoPath(owner.id, REC_PRIVATE, P2),
  ]);
  assert.equal((await rows(owner, 'select * from recording_photos')).length, 2);
});

test("photo rows must point at the owner's own folder", async () => {
  const bad = '20000000-0000-0000-0000-0000000000ff';
  assert.ok(await fails(owner, `insert into recording_photos (id, recording_id, storage_path) values ($1, $2, $3)`, [bad, REC_TEAM, photoPath(mate.id, REC_TEAM, bad)]));
  assert.ok(await fails(owner, `insert into recording_photos (id, recording_id, storage_path) values ($1, $2, $3)`, [bad, REC_TEAM, photoPath(owner.id, REC_PRIVATE, bad)]));
});

test("teammate sees team photos (rows and files) but not private ones, and can't add any", async () => {
  assert.deepEqual((await rows(mate, 'select id from recording_photos')).map((r) => r.id), [P1]);
  assert.deepEqual((await rows(mate, `select name from storage.objects where bucket_id = 'photos'`)).map((r) => r.name), [photoPath(owner.id, REC_TEAM, P1)]);
  const x = '20000000-0000-0000-0000-0000000000aa';
  assert.ok(await fails(mate, `insert into recording_photos (id, recording_id, storage_path, user_id) values ($1, $2, $3, $4)`, [x, REC_TEAM, photoPath(mate.id, REC_TEAM, x), mate.id]));
  assert.ok(await fails(mate, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [photoPath(owner.id, REC_TEAM, x)]));
  await rows(mate, `update recording_photos set caption = 'hacked'`);
  assert.equal((await rows(owner, `select caption from recording_photos where id = $1`, [P1]))[0].caption, null);
  await rows(mate, `delete from recording_photos`);
  assert.equal((await rows(owner, 'select * from recording_photos')).length, 2);
});

test('outsider sees no photos, and a junk folder name does not break the policy', async () => {
  assert.equal((await rows(outsider, 'select * from recording_photos')).length, 0);
  await asService(db, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('photos', 'someone/not-a-uuid/x.jpg')`));
  assert.equal((await rows(outsider, `select * from storage.objects where bucket_id = 'photos'`)).length, 0);
  assert.equal((await rows(mate, `select * from storage.objects where bucket_id = 'photos'`)).length, 1);
});

test('site log and task photos are readable by teammates with the notes', async () => {
  await asService(db, async (tx) => {
    await tx.query(`insert into summaries (recording_id, user_id, overview, site_log) values ($1, $2, 'walk', $3)`, [
      REC_TEAM,
      owner.id,
      JSON.stringify({ issues: [{ text: 'Missing firestop at level 3 riser', photo_ids: [P1] }] }),
    ]);
    await tx.query(`insert into tasks (recording_id, user_id, text, photo_ids) values ($1, $2, 'Firestop riser', $3)`, [REC_TEAM, owner.id, [P1]]);
  });
  const s = (await rows(mate, 'select site_log from summaries'))[0];
  assert.equal(s.site_log.issues[0].photo_ids[0], P1);
  assert.deepEqual((await rows(mate, 'select photo_ids from tasks'))[0].photo_ids, [P1]);
  assert.equal((await rows(outsider, 'select * from summaries')).length, 0);
});

test('vocabulary is capped at 100 words', async () => {
  const many = Array.from({ length: 101 }, (_, i) => `w${i}`);
  assert.ok(await fails(owner, `update projects set vocabulary = $1 where id = $2`, [many, teamProject]));
  await rows(owner, `update projects set vocabulary = $1 where id = $2`, [many.slice(0, 100), teamProject]);
});

test('Procore connection: allowed provider, tokens never readable by the app', async () => {
  await asService(db, (tx) =>
    tx.query(
      `insert into integrations (user_id, provider, secret, access_secret, access_expires_at, config) values ($1, 'procore', 'refresh-xyz', 'access-abc', now() + interval '1 hour', '{"account":"olivia@acme.com"}')`,
      [owner.id],
    ),
  );
  assert.deepEqual((await rows(owner, `select provider, config from integrations`))[0], { provider: 'procore', config: { account: 'olivia@acme.com' } });
  assert.ok(await fails(owner, `select secret from integrations`));
  assert.ok(await fails(owner, `select access_secret from integrations`));
  assert.ok(await fails(owner, `select * from integrations`));
  assert.ok(await fails(owner, `insert into integration_oauth_states (state, user_id, provider, return_to) values ('s', $1, 'procore', 'x')`, [owner.id]));
  await assert.rejects(asService(db, (tx) => tx.query(`insert into integrations (user_id, provider, secret) values ($1, 'dropbox', 'x')`, [mate.id])));
});
