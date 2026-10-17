// Editing, push tokens, richer share links, comments and search positions, as real users.
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
    const utt = [
      { start_ms: 0, end_ms: 4000, speaker: 0, text: 'Morning everyone.' },
      { start_ms: 61000, end_ms: 65000, speaker: 1, text: 'The tower crane arrives Monday.' },
    ];
    await tx.query(`insert into transcripts (recording_id, user_id, utterances, text) values ($1, $2, $3, 'Morning everyone. The tower crane arrives Monday.')`, [REC, owner.id, JSON.stringify(utt)]);
    await tx.query(`insert into summaries (recording_id, user_id, overview) values ($1, $2, 'AI wrote this')`, [REC, owner.id]);
  });
  const code = (await rows(owner, `select create_invite($1, 'ben@acme.com') as code`, [ws]))[0].code;
  await rows(mate, `select accept_invite($1)`, [code]);
});

test('owner edits notes, speaker names and transcript text; search text follows the edit', async () => {
  await rows(owner, `update summaries set overview = 'Corrected by Olivia', edited_at = now() where recording_id = $1`, [REC]);
  assert.equal((await rows(mate, 'select overview from summaries'))[0].overview, 'Corrected by Olivia');
  await rows(owner, `update transcripts set speaker_names = '{"1":"Maya"}', utterances = jsonb_set(utterances, '{1,text}', '"The tower crane arrives Tuesday."') where recording_id = $1`, [REC]);
  const t = (await rows(owner, 'select text, speaker_names from transcripts'))[0];
  assert.match(t.text, /Tuesday/);
  assert.equal(t.speaker_names['1'], 'Maya');
  assert.equal((await rows(owner, `select recording_id from search_recordings('tuesday')`)).length, 1);
  assert.equal((await rows(owner, `select recording_id from search_recordings('monday')`)).length, 0);
});

test("teammates and outsiders can't edit notes or transcripts", async () => {
  await rows(mate, `update summaries set overview = 'mate edit'`);
  await rows(mate, `update transcripts set speaker_names = '{"0":"hacked"}'`);
  await rows(outsider, `update summaries set overview = 'eve edit'`);
  assert.equal((await rows(owner, 'select overview from summaries'))[0].overview, 'Corrected by Olivia');
  assert.equal((await rows(owner, 'select speaker_names from transcripts'))[0].speaker_names['0'], undefined);
});

test('search points at the moment the words were said', async () => {
  const hit = (await rows(mate, `select at_ms, matched from search_recordings('crane')`))[0];
  assert.equal(hit.matched, 'transcript');
  assert.equal(hit.at_ms, 61000);
});

test('push tokens are private', async () => {
  await rows(owner, `insert into push_tokens (token, platform) values ('ExponentPushToken[abc]', 'ios')`);
  assert.equal((await rows(mate, 'select * from push_tokens')).length, 0);
  assert.ok(await fails(mate, `insert into push_tokens (token, platform, user_id) values ('x', 'ios', $1)`, [owner.id]));
});

test('share links: password stays hidden and is checked on the server; clips have sane ranges', async () => {
  const tok = (await rows(owner, `select create_share_link_v2($1, '{"password":"hunter22","allow_audio":true,"allow_questions":true}') as t`, [REC]))[0].t;
  assert.ok(await fails(owner, 'select password_hash from share_links'), 'hash column not readable');
  assert.equal((await rows(owner, 'select has_password from share_links'))[0].has_password, true);
  const ok = (pw) => asService(db, (tx) => tx.query('select share_password_ok($1, $2) as ok', [tok, pw])).then((r) => r.rows[0].ok);
  assert.equal(await ok('hunter22'), true);
  assert.equal(await ok('wrong'), false);
  assert.equal(await ok(null), false);
  assert.ok(await fails(owner, `select share_password_ok($1, 'hunter22')`, [tok]), 'service only');
  assert.ok(await fails(owner, `select create_share_link_v2($1, '{"password":"123"}')`, [REC]), 'short password refused');
  const clip = (await rows(owner, `select create_share_link_v2($1, '{"clip_start_ms":60000,"clip_end_ms":90000,"title":"Crane date"}') as t`, [REC]))[0].t;
  assert.ok(clip);
  assert.ok(await fails(owner, `select create_share_link_v2($1, '{"clip_start_ms":90000,"clip_end_ms":60000}')`, [REC]));
  assert.ok(await fails(owner, `select create_share_link_v2($1, '{"clip_start_ms":0,"clip_end_ms":900000}')`, [REC]), 'clips max 10 minutes');
  assert.ok(await fails(mate, `select create_share_link_v2($1, '{}')`, [REC]));
});

test('comments: team members comment and bookmark; outsiders cannot; owner can tidy up', async () => {
  await rows(mate, `insert into recording_comments (recording_id, kind, at_ms, body) values ($1, 'comment', 61000, 'Is Monday confirmed?')`, [REC]);
  await rows(owner, `insert into recording_comments (recording_id, kind, at_ms) values ($1, 'bookmark', 61000)`, [REC]);
  assert.equal((await rows(owner, 'select * from recording_comments')).length, 2);
  assert.equal((await rows(outsider, 'select * from recording_comments')).length, 0);
  assert.ok(await fails(outsider, `insert into recording_comments (recording_id, body) values ($1, 'spam')`, [REC]));
  await rows(mate, `delete from recording_comments where kind = 'bookmark'`);
  assert.equal((await rows(owner, `select * from recording_comments where kind = 'bookmark'`)).length, 1, "mate can't delete owner's bookmark");
  await rows(owner, `delete from recording_comments where kind = 'comment'`);
  assert.equal((await rows(owner, `select * from recording_comments where kind = 'comment'`)).length, 0, 'owner can remove comments on their recording');
});

test('typed meeting notes are the owner’s to write', async () => {
  await rows(owner, `update recordings set user_notes = 'crane - confirm date' where id = $1`, [REC]);
  await rows(mate, `update recordings set user_notes = 'x' where id = $1`, [REC]);
  assert.equal((await rows(owner, 'select user_notes from recordings'))[0].user_notes, 'crane - confirm date');
});
