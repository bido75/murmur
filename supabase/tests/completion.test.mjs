// Highlight reels, token-renewal lock, part cache: security rules as real users.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, freshDb } from './harness.mjs';

const a = { id: '00000000-0000-0000-0000-0000000000a1', email: 'a@acme.com' };
const b = { id: '00000000-0000-0000-0000-0000000000b2', email: 'b@acme.com' };
const c = { id: '00000000-0000-0000-0000-0000000000c3', email: 'c@else.com' };
let db, ws, project, mine, teammates, privateB;
const rows = async (u, sql, p = []) => (await as(db, u, (tx) => tx.query(sql, p))).rows;
const fails = async (u, sql, p = []) => {
  try {
    await as(db, u, (tx) => tx.query(sql, p));
    return false;
  } catch {
    return true;
  }
};
const svc = async (sql, p = []) => (await db.query(sql, p)).rows;

before(async () => {
  db = await freshDb();
  for (const u of [a, b, c]) await addUser(db, u.id, u.email);
  ws = (await rows(a, `select create_workspace('Acme') as id`))[0].id;
  await svc(`insert into workspace_members (workspace_id, user_id, role, email) values ($1, $2, 'member', $3)`, [ws, b.id, b.email]);
  project = (await rows(a, `insert into projects (name, workspace_id) values ('Riverside', $1) returning id`, [ws]))[0].id;
  mine = (await rows(a, `insert into recordings (title, project_id, status) values ('OAC', $1, 'ready') returning id`, [project]))[0].id;
  teammates = (await rows(b, `insert into recordings (title, project_id, status) values ('Walk', $1, 'ready') returning id`, [project]))[0].id;
  privateB = (await rows(b, `insert into recordings (title, status) values ('Private', 'ready') returning id`))[0].id;
});

test('reels: clips only from recordings you can read; team reels visible to the team', async () => {
  const p = (await rows(a, `insert into playlists (title, workspace_id) values ('Best of OAC', $1) returning id`, [ws]))[0].id;
  await rows(a, `insert into playlist_items (playlist_id, recording_id, start_ms, end_ms, position) values ($1, $2, 0, 30000, 0), ($1, $3, 5000, 20000, 1)`, [p, mine, teammates]);
  assert.ok(await fails(a, `insert into playlist_items (playlist_id, recording_id, start_ms, end_ms) values ($1, $2, 0, 1000)`, [p, privateB]), "someone else's private recording");
  assert.ok(await fails(a, `insert into playlist_items (playlist_id, recording_id, start_ms, end_ms) values ($1, $2, 0, 700000)`, [p, mine]), 'max 10 minutes');
  assert.equal((await rows(b, 'select * from playlist_items where playlist_id = $1', [p])).length, 2, 'teammate sees the team reel');
  assert.ok(await fails(b, `insert into playlist_items (playlist_id, recording_id, start_ms, end_ms) values ($1, $2, 0, 1000)`, [p, teammates]), 'only the creator edits');
  assert.equal((await rows(c, 'select * from playlists')).length, 0);
  assert.ok(await fails(c, `insert into playlists (title, workspace_id) values ('x', $1)`, [ws]));
  assert.ok(await fails(a, `update playlists set share_token = 'abc' where id = $1`, [p]), 'tokens only via the function');
});

test("public reels show only the creator's own recordings, and follow the team's link policy", async () => {
  const p = (await rows(a, 'select id from playlists limit 1'))[0].id;
  assert.ok(await fails(b, 'select set_playlist_sharing($1, true)', [p]));
  const tok = (await rows(a, 'select set_playlist_sharing($1, true) t', [p]))[0].t;
  assert.match(tok, /^[A-Za-z0-9_-]{24}$/);
  assert.equal((await rows(a, 'select set_playlist_sharing($1, true) t', [p]))[0].t, tok, 'same link when turned on again');
  let items = await svc('select * from public_reel_items($1)', [tok]);
  assert.deepEqual(items.map((i) => i.recording_title), ['OAC'], "a teammate's recording isn't published by someone else");
  await rows(a, `insert into workspace_policies (workspace_id, allow_public_links) values ($1, false)`, [ws]);
  items = await svc('select * from public_reel_items($1)', [tok]);
  assert.equal(items.length, 0, 'team turned public links off');
  await rows(a, 'select set_playlist_sharing($1, false)', [p]);
  assert.equal((await svc('select * from public_reel_items($1)', [tok])).length, 0);
  assert.ok(await fails(a, 'select * from public_reel_items($1)', [tok]), 'server only');
});

test('token renewal: one at a time; part transcripts private', async () => {
  await svc(`insert into integrations (user_id, provider, secret) values ($1, 'procore', 'r')`, [a.id]);
  assert.equal((await svc(`select claim_token_refresh($1, 'procore') ok`, [a.id]))[0].ok, true);
  assert.equal((await svc(`select claim_token_refresh($1, 'procore') ok`, [a.id]))[0].ok, false, 'second renewal waits');
  await svc(`update integrations set refreshing_until = now() - interval '1 second'`);
  assert.equal((await svc(`select claim_token_refresh($1, 'procore') ok`, [a.id]))[0].ok, true, 'lease expires');
  assert.ok(await fails(a, `select claim_token_refresh($1, 'procore')`, [a.id]));
  await svc(`insert into segment_transcripts (recording_id, idx, cache_key, utterances) values ($1, 1, 'k', '[]')`, [mine]);
  assert.ok(await fails(a, 'select * from segment_transcripts'));
  assert.ok(await fails(a, `insert into recordings (title, channels) values ('x', 3)`));
  await rows(a, `insert into recordings (title, channels, source) values ('Desktop', 2, 'mic')`);
});

test('AI tools reach every readable recording, old ones included', async () => {
  // 1,100 old recordings for a; the oldest has a word nobody else said.
  await svc(`insert into recordings (user_id, title, created_at, status) select $1, 'Old ' || g, now() - (g || ' days')::interval, 'ready' from generate_series(1, 1100) g`, [a.id]);
  const oldest = (await svc(`select id from recordings where title = 'Old 1100'`))[0].id;
  await svc(`insert into transcripts (recording_id, user_id, utterances, text) values ($1, $2, '[{"start_ms": 42000, "end_ms": 43000, "speaker": 0, "text": "the zeppelin arrives"}]', 'the zeppelin arrives')`, [oldest, a.id]);
  const hits = await svc(`select * from search_recordings_for($1, 'zeppelin', 10)`, [a.id]);
  assert.deepEqual(hits.map((h) => [h.title, h.at_ms]), [['Old 1100', 42000]]);
  assert.equal((await svc(`select * from search_recordings_for($1, 'zeppelin', 10)`, [c.id])).length, 0, 'outsider finds nothing');
  const page = await svc(`select title from readable_recording_page($1, null, null, now() - interval '1099 days 12 hours', 5)`, [a.id]);
  assert.deepEqual(page.map((p) => p.title), ['Old 1100']);
  assert.equal((await svc(`select * from readable_recording_page($1, $2, null, null, 50)`, [b.id, project])).length, 2, 'teammate sees team project');
  await svc(`insert into tasks (recording_id, user_id, text, status, needs_review) values ($1, $2, 'Old task', 'open', false)`, [oldest, a.id]);
  assert.equal((await svc(`select * from readable_tasks($1, 'open', null, 50)`, [a.id])).length, 1);
  assert.equal((await svc(`select * from readable_tasks($1, 'open', null, 50)`, [c.id])).length, 0);
  assert.ok(await fails(a, `select * from search_recordings_for($1, 'zeppelin', 10)`, [a.id]), 'server only');
});
