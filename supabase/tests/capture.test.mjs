// Phone links, device codes and inbound hooks: security rules as real users.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { addUser, as, freshDb } from './harness.mjs';

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
const svc = async (sql, p = []) => (await db.query(sql, p)).rows;

before(async () => {
  db = await freshDb();
  await addUser(db, a.id, a.email);
  await addUser(db, b.id, b.email);
});

test('phone link: validated, PIN hashed and hidden, one account per number', async () => {
  assert.ok(await fails(a, `select set_phone_link('5125550123', '4821')`), 'needs country code');
  assert.ok(await fails(a, `select set_phone_link('+15125550123', '1111')`), 'obvious PIN');
  assert.ok(await fails(a, `select set_phone_link('+15125550123', '12a4')`));
  await rows(a, `select set_phone_link('+15125550123', '4821')`);
  assert.ok(await fails(b, `select set_phone_link('+15125550123', '9037')`), 'taken by a');
  assert.ok(await fails(a, 'select pin_hash from phone_links'), 'hash not readable');
  assert.equal((await rows(a, 'select phone_e164 from phone_links'))[0].phone_e164, '+15125550123');
  assert.equal((await rows(b, 'select phone_e164 from phone_links')).length, 0);
  assert.ok(await fails(a, `select * from phone_pin_check('+15125550123', '4821')`), 'service only');
});

test('phone PIN check locks after five wrong tries', async () => {
  const check = async (pin) => (await svc(`select * from phone_pin_check('+15125550123', $1)`, [pin]))[0];
  assert.equal((await check('4821')).ok, true);
  assert.equal((await svc(`select * from phone_pin_check('+19999999999', '4821')`)).length, 0, 'unknown caller');
  for (let i = 0; i < 4; i++) assert.equal((await check('0000')).locked, false);
  assert.equal((await check('0000')).locked, true);
  const r = await check('4821');
  assert.equal(r.ok, false, 'right PIN refused while locked');
  assert.equal(r.locked, true);
  await svc(`update phone_links set locked_until = now() - interval '1 minute'`);
  assert.equal((await check('4821')).ok, true);
});

test('device codes: one use, give an upload token, devices private', async () => {
  const code = (await rows(a, 'select create_device_link() as c'))[0].c;
  assert.match(code, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.ok(await fails(a, `select redeem_device_link($1, 'x', 'watch')`, [code]), 'service only');
  const pretty = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;
  const tok = (await svc(`select redeem_device_link($1, 'Apple Watch', 'watch') as t`, [pretty]))[0].t;
  assert.match(tok, /^mdv_[0-9a-f]{48}$/);
  assert.equal((await svc(`select redeem_device_link($1, 'again', 'watch') as t`, [code]))[0].t, null, 'single use');
  const mine = await rows(a, 'select name, kind from device_tokens');
  assert.deepEqual(mine, [{ name: 'Apple Watch', kind: 'watch' }]);
  assert.ok(await fails(a, 'select token_hash from device_tokens'));
  assert.ok(await fails(b, 'select * from device_links'), 'codes not readable at all');
  assert.equal((await rows(b, 'select id from device_tokens')).length, 0);
  await svc(`update device_links set expires_at = now() - interval '1 second'`);
  const code2 = (await rows(a, 'select create_device_link() as c'))[0].c;
  await svc(`update device_links set expires_at = now() - interval '1 second'`);
  assert.equal((await svc(`select redeem_device_link($1, 'late', 'wear') as t`, [code2]))[0].t, null, 'expired');
  await rows(a, 'delete from device_tokens');
  assert.equal((await svc('select count(*)::int as n from device_tokens'))[0].n, 0);
});

test('inbound hooks: key generated, verify token write-only, private', async () => {
  const h = (await rows(a, `insert into inbound_hooks (provider) values ('aircall') returning key`))[0];
  assert.match(h.key, /^[0-9a-f]{36}$/);
  await rows(a, `update inbound_hooks set verify_token = 'abc' where provider = 'aircall'`);
  assert.ok(await fails(a, 'select verify_token from inbound_hooks'));
  assert.equal((await rows(b, 'select key from inbound_hooks')).length, 0);
  assert.ok(await fails(a, `insert into inbound_hooks (provider) values ('zoom')`));
  assert.equal((await svc('select verify_token from inbound_hooks'))[0].verify_token, 'abc');
});

test('recordings accept the new sources and dedupe external calls', async () => {
  const ins = (ref) => rows(a, `insert into recordings (title, source, consent_method, external_ref) values ('Call', 'phone', 'phone_announced', $1) returning id`, [ref]);
  await ins('CA123');
  assert.ok(await fails(a, `insert into recordings (title, source, consent_method, external_ref) values ('Call', 'phone', 'phone_announced', 'CA123')`));
  await rows(b, `insert into recordings (title, source, consent_method, external_ref) values ('Call', 'phone', 'phone_announced', 'CA123')`);
  assert.ok(await fails(a, `insert into recordings (title, source) values ('x', 'fax')`));
});
