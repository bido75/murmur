// Search, share links, templates, consent links, retention and bots: security rules as real users.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, asService, freshDb } from './harness.mjs';

const owner = { id: '00000000-0000-0000-0000-0000000000a1', email: 'olivia@acme.com' };
const mate = { id: '00000000-0000-0000-0000-0000000000b2', email: 'ben@acme.com' };
const outsider = { id: '00000000-0000-0000-0000-0000000000c3', email: 'eve@else.com' };

const REC_TEAM = '10000000-0000-0000-0000-000000000001';
const REC_PRIVATE = '10000000-0000-0000-0000-000000000002';
const REC_OLD = '10000000-0000-0000-0000-000000000003';

let db, ws;
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
  ws = (await rows(owner, `select create_workspace('Acme Builders') as id`))[0].id;
  const team = (await rows(owner, `insert into projects (name, workspace_id) values ('Riverside Lofts', $1) returning id`, [ws]))[0].id;
  await rows(owner, `insert into recordings (id, title, project_id) values ($1, 'Crane planning', $2)`, [REC_TEAM, team]);
  await rows(owner, `insert into recordings (id, title) values ($1, 'Salary review')`, [REC_PRIVATE]);
  await rows(owner, `insert into recordings (id, title, created_at) values ($1, 'Old walk', now() - interval '400 days')`, [REC_OLD]);
  await asService(db, async (tx) => {
    await tx.query(`insert into transcripts (recording_id, user_id, text) values ($1, $2, 'the tower crane is booked for monday morning')`, [REC_TEAM, owner.id]);
    await tx.query(`insert into transcripts (recording_id, user_id, text) values ($1, $2, 'the crane budget and your salary')`, [REC_PRIVATE, owner.id]);
    await tx.query(`insert into summaries (recording_id, user_id, overview) values ($1, $2, 'Discussed pay bands')`, [REC_PRIVATE, owner.id]);
  });
  const code = (await rows(owner, `select create_invite($1, 'ben@acme.com') as code`, [ws]))[0].code;
  await rows(mate, `select accept_invite($1)`, [code]);
});

test('search: matches transcript, title and notes, only within what each person can read', async () => {
  const mine = await rows(owner, `select recording_id, matched, snippet from search_recordings('crane')`);
  assert.deepEqual(new Set(mine.map((r) => r.recording_id)), new Set([REC_TEAM, REC_PRIVATE]));
  assert.match(mine.find((r) => r.recording_id === REC_TEAM).snippet, /\[\[crane\]\]/);
  assert.deepEqual((await rows(mate, `select recording_id from search_recordings('crane')`)).map((r) => r.recording_id), [REC_TEAM]);
  assert.equal((await rows(outsider, `select * from search_recordings('crane')`)).length, 0);
  assert.equal((await rows(owner, `select matched from search_recordings('pay bands')`))[0].matched, 'notes');
  assert.equal((await rows(owner, `select matched from search_recordings('salary review')`))[0].matched, 'title');
  assert.equal((await rows(owner, `select * from search_recordings('%')`)).length, 0, 'wildcards are literal');
  assert.equal((await rows(owner, `select * from search_recordings(' ')`)).length, 0);
});

test('share links: only the recording owner creates, sees and revokes them', async () => {
  const tok = (await rows(owner, `select create_share_link($1, true, 7) as t`, [REC_TEAM]))[0].t;
  assert.match(tok, /^[A-Za-z0-9_-]{24}$/);
  assert.ok(await fails(mate, `select create_share_link($1)`, [REC_TEAM]));
  assert.ok(await fails(outsider, `select create_share_link($1)`, [REC_PRIVATE]));
  assert.equal((await rows(mate, 'select * from share_links')).length, 0);
  assert.equal((await rows(outsider, 'select * from share_links')).length, 0);
  assert.ok(await fails(owner, `insert into share_links (token, recording_id) values ('x', $1)`, [REC_TEAM]), 'links only via the function');
  assert.ok(await fails(owner, `update share_links set include_transcript = false`), 'only revoked_at is editable');
  await rows(owner, `update share_links set revoked_at = now()`);
  assert.ok((await rows(owner, 'select revoked_at from share_links'))[0].revoked_at);
  assert.equal((await rows(owner, `select (expires_at - created_at) > interval '6 days' as ok from share_links`))[0].ok, true);
});

test('templates: personal stay private; team templates need an admin; members can use them', async () => {
  await rows(owner, `insert into summary_templates (name, instructions) values ('My 1:1s', 'Focus on feedback')`);
  await rows(owner, `insert into summary_templates (name, instructions, workspace_id, base) values ('OAC meeting', 'Owner-architect-contractor format', $1, 'meeting')`, [ws]);
  assert.deepEqual((await rows(mate, 'select name from summary_templates')).map((r) => r.name), ['OAC meeting']);
  assert.ok(await fails(mate, `insert into summary_templates (name, instructions, workspace_id) values ('x', 'y', $1)`, [ws]));
  await rows(mate, `update summary_templates set instructions = 'hijack'`);
  assert.equal((await rows(owner, `select instructions from summary_templates where name = 'OAC meeting'`))[0].instructions, 'Owner-architect-contractor format');
  assert.equal((await rows(outsider, 'select * from summary_templates')).length, 0);
  assert.ok(await fails(owner, `insert into summary_templates (name, instructions, base) values ('x', 'y', 'nonsense')`));
});

test('consent links: organizer and teammates see responses; nobody can write them directly', async () => {
  const tok = (await rows(owner, `select create_consent_request('Riverside OAC #12', $1) as t`, [REC_TEAM]))[0].t;
  const req = (await asService(db, (tx) => tx.query('select id, organizer from consent_requests where token = $1', [tok]))).rows[0];
  assert.equal(req.organizer, 'olivia@acme.com');
  await asService(db, (tx) => tx.query(`insert into consent_responses (request_id, name, decision) values ($1, 'Sam (architect)', 'agree'), ($1, 'Pat', 'decline')`, [req.id]));
  assert.equal((await rows(owner, 'select * from consent_responses')).length, 2);
  assert.equal((await rows(mate, 'select * from consent_responses')).length, 2, 'teammate sees responses for a team recording');
  assert.equal((await rows(outsider, 'select * from consent_responses')).length, 0);
  assert.ok(await fails(outsider, `insert into consent_responses (request_id, name, decision) values ($1, 'x', 'agree')`, [req.id]));
  assert.ok(await fails(owner, `insert into consent_responses (request_id, name, decision) values ($1, 'fake', 'agree')`, [req.id]), 'organizer cannot forge an agreement');
  assert.ok(await fails(mate, `select create_consent_request('x', $1)`, [REC_TEAM]), "can't attach to someone else's recording");
  await rows(mate, `update consent_requests set recording_id = null`);
  assert.equal((await asService(db, (tx) => tx.query('select recording_id from consent_requests where id = $1', [req.id]))).rows[0].recording_id, REC_TEAM);
});

test('recording consent method accepts the new options', async () => {
  await rows(owner, `update recordings set consent_method = 'consent_link' where id = $1`, [REC_TEAM]);
  assert.ok(await fails(owner, `update recordings set consent_method = 'whatever' where id = $1`, [REC_TEAM]));
});

test('retention: settings are private; the cleanup list respects each setting', async () => {
  await rows(owner, `insert into user_settings (audio_retention_days, recording_retention_days) values (30, 365)`);
  assert.equal((await rows(mate, 'select * from user_settings')).length, 0);
  assert.ok(await fails(mate, `insert into user_settings (user_id, audio_retention_days) values ($1, 1)`, [owner.id]));
  assert.ok(await fails(owner, `select * from retention_due()`), 'service only');
  const due = (await asService(db, (tx) => tx.query('select recording_id, action from retention_due()'))).rows;
  assert.deepEqual(due, [{ recording_id: REC_OLD, action: 'delete_recording' }], 'new recordings are kept; the 400-day-old one goes');
  await asService(db, (tx) => tx.query(`update recordings set created_at = now() - interval '40 days' where id = $1`, [REC_PRIVATE]));
  const due2 = (await asService(db, (tx) => tx.query('select recording_id, action from retention_due() order by action'))).rows;
  assert.deepEqual(due2, [{ recording_id: REC_PRIVATE, action: 'delete_audio' }, { recording_id: REC_OLD, action: 'delete_recording' }]);
});

test('account deletion is blocked only for the last owner of a team with other members', async () => {
  const block = (uid) => asService(db, (tx) => tx.query('select name from teams_blocking_deletion($1)', [uid]));
  assert.deepEqual((await block(owner.id)).rows.map((r) => r.name), ['Acme Builders']);
  assert.equal((await block(mate.id)).rows.length, 0);
  assert.ok(await fails(owner, 'select * from teams_blocking_deletion($1)', [owner.id]));
});

test('meeting bots are readable with the recording and writable only by the server', async () => {
  await asService(db, (tx) => tx.query(`insert into meeting_bots (user_id, recording_id, meeting_url) values ($1, $2, 'https://meet.google.com/abc-defg-hij')`, [owner.id, REC_TEAM]));
  assert.equal((await rows(mate, 'select * from meeting_bots')).length, 1);
  assert.equal((await rows(outsider, 'select * from meeting_bots')).length, 0);
  assert.ok(await fails(owner, `insert into meeting_bots (recording_id, meeting_url) values ($1, 'https://zoom.us/j/1')`, [REC_PRIVATE]));
  assert.ok(await fails(owner, `update meeting_bots set status = 'done'`));
});

test('link segments: https only, and a segment needs a file or a link', async () => {
  await rows(owner, `insert into recording_segments (recording_id, idx, source_url) values ($1, 1, 'https://example.com/a.mp3')`, [REC_PRIVATE]);
  assert.ok(await fails(owner, `insert into recording_segments (recording_id, idx, source_url) values ($1, 2, 'http://169.254.169.254/x')`, [REC_PRIVATE]));
  assert.ok(await fails(owner, `insert into recording_segments (recording_id, idx) values ($1, 3)`, [REC_PRIVATE]));
});

test('account deletion keeps shared work: team projects pass to a teammate, solo teams go', async () => {
  // Make the mate an owner so the original owner may leave, then delete the original owner.
  await rows(owner, `select set_member_role($1, $2, 'owner')`, [ws, mate.id]);
  const solo = (await rows(owner, `select create_workspace('Just me') as id`))[0].id;
  await asService(db, (tx) => tx.query('select prepare_account_deletion($1)', [owner.id]));
  await db.query('delete from auth.users where id = $1', [owner.id]); // what auth.admin.deleteUser does
  const p = (await rows(mate, `select name, user_id from projects`));
  assert.deepEqual(p, [{ name: 'Riverside Lofts', user_id: mate.id }], 'team project survives with the teammate as owner');
  assert.deepEqual((await rows(mate, 'select name from workspaces')).map((w) => w.name), ['Acme Builders']);
  assert.equal((await asService(db, (tx) => tx.query('select count(*)::int as n from workspaces where id = $1', [solo]))).rows[0].n, 0);
  assert.equal((await rows(mate, `select name from summary_templates`)).length, 1, 'team template kept');
  assert.equal((await rows(mate, 'select * from recordings')).length, 0, "the deleted user's own recordings are gone");
});
