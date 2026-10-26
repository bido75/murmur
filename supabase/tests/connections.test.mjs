// Webhooks, automations, topic alerts and notetaker dedupe: security rules as real users.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, asService, freshDb } from './harness.mjs';

const a = { id: '00000000-0000-0000-0000-0000000000a1', email: 'a@x.com' };
const b = { id: '00000000-0000-0000-0000-0000000000b2', email: 'b@x.com' };
let db;
const rows = async (u, sql, p = []) => (await as(db, u, (tx) => tx.query(sql, p))).rows;
const fails = async (u, sql, p = []) => {
  try {
    await as(db, u, (tx) => tx.query(sql, p));
    return false;
  } catch {
    return true;
  }
};

before(async () => {
  db = await freshDb();
  await addUser(db, a.id, a.email);
  await addUser(db, b.id, b.email);
});

test('webhooks: https only, private to their owner, secret generated', async () => {
  const w = (await rows(a, `insert into webhooks (url) values ('https://hooks.zapier.com/hooks/catch/1/abc') returning secret, events`))[0];
  assert.match(w.secret, /^[0-9a-f]{48}$/);
  assert.deepEqual(w.events, ['recording.ready']);
  assert.ok(await fails(a, `insert into webhooks (url) values ('http://insecure.example')`));
  assert.ok(await fails(a, `insert into webhooks (url, events) values ('https://x.example', '{everything}')`));
  assert.equal((await rows(b, 'select * from webhooks')).length, 0);
  assert.ok(await fails(b, `insert into webhooks (url, user_id) values ('https://x.example', $1)`, [a.id]));
});

test('webhooks cannot point at the server or private networks (SSRF)', async () => {
  const blocked = [
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://localhost/x',
    'https://kong/x',
    'https://foo.local/x',
    'https://foo.internal/x',
  ];
  for (const url of blocked) {
    assert.ok(await fails(a, `insert into webhooks (url) values ($1::text)`, [url]), `should block ${url}`);
  }
  // A real public host still works.
  await rows(a, `insert into webhooks (url) values ('https://hooks.zapier.com/hooks/catch/1/abc')`);
});

test('automations and topic alerts are private and validated', async () => {
  await rows(a, `insert into automations (name, actions) values ('Post to Slack', '[{"type":"slack"}]')`);
  assert.ok(await fails(a, `insert into automations (name, actions) values ('Empty', '[]')`));
  assert.ok(await fails(a, `insert into automations (name, actions) values ('Bad', '{"type":"slack"}')`));
  await rows(a, `insert into topic_alerts (phrase) values ('change order')`);
  assert.ok(await fails(a, `insert into topic_alerts (phrase) values ('x')`));
  assert.equal((await rows(b, 'select * from automations')).length, 0);
  assert.equal((await rows(b, 'select * from topic_alerts')).length, 0);
});

test('new providers are accepted; unknown ones are not', async () => {
  await asService(db, (tx) => tx.query(`insert into integrations (user_id, provider, secret) values ($1, 'slack', 'https://hooks.slack.com/x'), ($1, 'notion', 'ntn_x'), ($1, 'salesforce', 'r')`, [a.id]));
  await assert.rejects(asService(db, (tx) => tx.query(`insert into integrations (user_id, provider, secret) values ($1, 'myspace', 'x')`, [a.id])));
  assert.ok(await fails(a, 'select secret from integrations'), 'secrets stay unreadable');
});

test('a calendar meeting gets at most one automatic notetaker', async () => {
  await rows(a, `insert into recordings (id, title) values ('10000000-0000-0000-0000-000000000001', 'm1'), ('10000000-0000-0000-0000-000000000002', 'm2')`);
  const ins = (rid) => asService(db, (tx) => tx.query(`insert into meeting_bots (user_id, recording_id, meeting_url, event_key, event_start) values ($1, $2, 'https://zoom.us/j/1', 'g:abc', '2026-10-19T13:10:00Z')`, [a.id, rid]));
  await ins('10000000-0000-0000-0000-000000000001');
  await assert.rejects(ins('10000000-0000-0000-0000-000000000002'));
});

test('digest and notetaker settings are the user’s own', async () => {
  await rows(a, `insert into user_settings (weekly_digest, auto_notetaker, timezone) values (true, true, 'America/New_York')`);
  assert.equal((await rows(b, 'select * from user_settings')).length, 0);
});
