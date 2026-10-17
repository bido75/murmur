// Team policies, audit log, usage, domains and SCIM tokens: security rules as real users.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, freshDb } from './harness.mjs';

const owner = { id: '00000000-0000-0000-0000-0000000000a1', email: 'owner@acme.com' };
const member = { id: '00000000-0000-0000-0000-0000000000b2', email: 'maya@acme.com' };
const outsider = { id: '00000000-0000-0000-0000-0000000000c3', email: 'x@else.com' };
const newHire = { id: '00000000-0000-0000-0000-0000000000d4', email: 'sam@acme.com' };
let db, ws, project, rec;
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
  for (const u of [owner, member, outsider, newHire]) await addUser(db, u.id, u.email);
  ws = (await rows(owner, `select create_workspace('Acme') as id`))[0].id;
  await svc(`insert into workspace_members (workspace_id, user_id, role, email) values ($1, $2, 'member', $3)`, [ws, member.id, member.email]);
  project = (await rows(owner, `insert into projects (name, workspace_id) values ('Riverside', $1) returning id`, [ws]))[0].id;
  rec = (await rows(member, `insert into recordings (title, project_id, duration_ms) values ('OAC', $1, 1800000) returning id`, [project]))[0].id;
});

test('only admins set the team policy; members can read it', async () => {
  assert.ok(await fails(member, `insert into workspace_policies (workspace_id, redact) values ($1, '{pii}')`, [ws]));
  await rows(owner, `insert into workspace_policies (workspace_id, redact, max_link_days) values ($1, '{pii}', 7)`, [ws]);
  assert.deepEqual((await rows(member, 'select redact, max_link_days from workspace_policies'))[0], { redact: ['pii'], max_link_days: 7 });
  assert.equal((await rows(outsider, 'select * from workspace_policies')).length, 0);
  assert.ok(await fails(owner, `update workspace_policies set redact = '{everything}'`));
  assert.equal((await rows(owner, 'select updated_by from workspace_policies'))[0].updated_by, owner.id);
});

test('share links: capped by the policy, revoked and blocked when turned off', async () => {
  await rows(member, `select create_share_link_v2($1, '{"valid_days": 90}')`, [rec]);
  const l = (await rows(member, 'select expires_at from share_links where recording_id = $1', [rec]))[0];
  const days = (new Date(l.expires_at) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days < 7.1, `capped to 7 days, got ${days}`);
  await rows(member, `select create_share_link_v2($1)`, [rec]);
  assert.equal((await rows(member, 'select count(*)::int n from share_links where expires_at is null')).length, 1);
  await rows(owner, 'update workspace_policies set allow_public_links = false where workspace_id = $1', [ws]);
  assert.equal((await svc('select count(*)::int n from share_links where revoked_at is null'))[0].n, 0, 'existing links revoked');
  assert.ok(await fails(member, `select create_share_link_v2($1)`, [rec]));
  // A personal recording moved into the team project loses its links.
  const mine = (await rows(member, `insert into recordings (title) values ('Mine') returning id`))[0].id;
  await rows(member, 'select create_share_link_v2($1)', [mine]);
  await rows(member, 'update recordings set project_id = $2 where id = $1', [mine, project]);
  assert.equal((await svc('select count(*)::int n from share_links where recording_id = $1 and revoked_at is null', [mine]))[0].n, 0);
  await rows(owner, 'update workspace_policies set allow_public_links = true where workspace_id = $1', [ws]);
});

test('team retention applies to team-project recordings; shortest wins', async () => {
  const old = (await rows(member, `insert into recordings (title, project_id, created_at) values ('Old', $1, now() - interval '40 days') returning id`, [project]))[0].id;
  const personalOld = (await rows(member, `insert into recordings (title, created_at) values ('Personal old', now() - interval '40 days') returning id`))[0].id;
  await rows(owner, 'update workspace_policies set audio_retention_days = 30, recording_retention_days = 365 where workspace_id = $1', [ws]);
  let due = await svc('select * from retention_due(100)');
  assert.deepEqual(due.filter((d) => d.recording_id === old).map((d) => d.action), ['delete_audio']);
  assert.equal(due.filter((d) => d.recording_id === personalOld).length, 0, 'personal recordings follow only the owner');
  await svc(`insert into user_settings (user_id, recording_retention_days) values ($1, 35)`, [member.id]);
  due = await svc('select * from retention_due(100)');
  assert.deepEqual(due.filter((d) => d.recording_id === old).map((d) => d.action), ['delete_recording']);
  assert.deepEqual(due.filter((d) => d.recording_id === personalOld).map((d) => d.action), ['delete_recording']);
  await svc('delete from user_settings');
  await rows(owner, 'update workspace_policies set audio_retention_days = null, recording_retention_days = null where workspace_id = $1', [ws]);
});

test('audit log: team events for admins only; personal events for their owner', async () => {
  await rows(owner, `select create_api_token('laptop')`);
  await rows(member, 'delete from recordings where title = $1', ['Mine']);
  const events = await rows(owner, 'select action, actor_email from audit_events where workspace_id = $1 order by id', [ws]);
  const actions = events.map((e) => e.action);
  for (const a of ['member.added', 'project.created', 'policy.updated', 'share_link.created', 'share_link.revoked', 'recording.moved_in', 'recording.deleted']) {
    assert.ok(actions.includes(a), `missing ${a}`);
  }
  assert.equal(events.find((e) => e.action === 'recording.deleted').actor_email, member.email);
  assert.equal((await rows(member, 'select * from audit_events where workspace_id = $1', [ws])).length, 0, 'members cannot read the team log');
  assert.deepEqual((await rows(owner, 'select action from audit_events where workspace_id is null')).map((e) => e.action), ['api_token.added']);
  const theirs = await rows(member, 'select actor from audit_events where workspace_id is null');
  assert.ok(theirs.length > 0 && theirs.every((e) => e.actor === member.id), 'only their own personal events (e.g. a link on a personal recording)');
  assert.ok(await fails(owner, `insert into audit_events (action) values ('fake')`));
  assert.ok(await fails(owner, 'delete from audit_events'));
  assert.ok(await fails(owner, `select audit(null, 'fake', null, null)`));
});

test('usage: admins see team-project minutes per member', async () => {
  const u = await rows(owner, 'select email, recordings::int, minutes::float from workspace_usage($1, 30)', [ws]);
  assert.deepEqual(u.find((x) => x.email === member.email), { email: member.email, recordings: 1, minutes: 30 });
  assert.equal((await rows(member, 'select * from workspace_usage($1, 30)', [ws])).length, 0);
});

test('domains: admins claim, only the server verifies; verified domains auto-join and report SSO', async () => {
  assert.ok(await fails(member, `insert into workspace_domains (domain, workspace_id) values ('acme.com', $1)`, [ws]));
  assert.ok(await fails(owner, `insert into workspace_domains (domain, workspace_id, verified_at) values ('acme.com', $1, now())`, [ws]));
  const d = (await rows(owner, `insert into workspace_domains (domain, workspace_id) values ('acme.com', $1) returning verify_token`, [ws]))[0];
  assert.match(d.verify_token, /^murmur-verify=[0-9a-f]{32}$/);
  assert.ok(await fails(owner, `update workspace_domains set verified_at = now()`), 'cannot self-verify');
  assert.equal((await rows(newHire, 'select join_domain_teams() n'))[0].n, 0, 'not verified yet');
  await svc(`update workspace_domains set verified_at = now(), sso_provider_id = 'sso-1', sso_required = true`);
  assert.deepEqual((await svc(`select * from sso_for_email('Sam@ACME.com')`))[0], { sso: true, required: true });
  assert.equal((await svc(`select * from sso_for_email('sam@other.com')`)).length, 0);
  assert.equal((await rows(newHire, 'select join_domain_teams() n'))[0].n, 1);
  assert.equal((await rows(newHire, 'select join_domain_teams() n'))[0].n, 0, 'once');
  assert.equal((await rows(outsider, 'select join_domain_teams() n'))[0].n, 0);
  await svc('update auth.users set email_confirmed_at = null where id = $1', [outsider.id]);
});

test('SCIM tokens: admin only, hashed, at most 3', async () => {
  assert.ok(await fails(member, 'select create_scim_token($1)', [ws]));
  const t = (await rows(owner, 'select create_scim_token($1) t', [ws]))[0].t;
  assert.match(t, /^scim_[0-9a-f]{48}$/);
  assert.ok(await fails(owner, 'select token_hash from scim_tokens'));
  assert.equal((await rows(member, 'select id from scim_tokens')).length, 0);
  await rows(owner, 'select create_scim_token($1)', [ws]);
  await rows(owner, 'select create_scim_token($1)', [ws]);
  assert.ok(await fails(owner, 'select create_scim_token($1)', [ws]));
});
