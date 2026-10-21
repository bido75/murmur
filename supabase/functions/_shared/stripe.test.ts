import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripeSignatureParts, stripeSignatureValid } from './stripe.ts';

const secret = 'whsec_test';
const body = '{"id":"evt_1"}';

async function header(payload: string, t: number, key = secret): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

test('the header is read as a timestamp and every signature in it', () => {
  const parts = stripeSignatureParts('t=1700000000,v1=aaa,v1=bbb');
  assert.equal(parts.t, 1700000000);
  assert.deepEqual(parts.v1, ['aaa', 'bbb']);
});

test('a header with nothing useful in it has no timestamp and no signature', () => {
  const parts = stripeSignatureParts('nonsense');
  assert.ok(Number.isNaN(parts.t));
  assert.deepEqual(parts.v1, []);
});

test('a correct Stripe signature is accepted', async () => {
  const now = 1700000000000;
  const h = await header(body, 1700000000);
  assert.equal(await stripeSignatureValid(secret, body, h, now), true);
});

test('a signature made with another secret is refused', async () => {
  const now = 1700000000000;
  const h = await header(body, 1700000000, 'whsec_other');
  assert.equal(await stripeSignatureValid(secret, body, h, now), false);
});

test('a signature for a different body is refused', async () => {
  const now = 1700000000000;
  const h = await header('{"id":"evt_2"}', 1700000000);
  assert.equal(await stripeSignatureValid(secret, body, h, now), false);
});

test('an old timestamp is refused', async () => {
  const h = await header(body, 1700000000);
  assert.equal(await stripeSignatureValid(secret, body, h, 1700000000000 + 301_000), false);
  assert.equal(await stripeSignatureValid(secret, body, h, 1700000000000 - 301_000), false);
});

test('a header with two signatures is accepted when either one is ours', async () => {
  const now = 1700000000000;
  const good = await header(body, 1700000000);
  const hex = good.split('v1=')[1];
  // Stripe sends one v1 per endpoint secret while a rotated secret is still active.
  assert.equal(await stripeSignatureValid(secret, body, `t=1700000000,v1=deadbeef,v1=${hex}`, now), true);
  assert.equal(await stripeSignatureValid(secret, body, `t=1700000000,v1=${hex},v1=deadbeef`, now), true);
  assert.equal(await stripeSignatureValid(secret, body, 't=1700000000,v1=deadbeef,v1=feedface', now), false);
});

test('a header without a signature or without a timestamp is refused', async () => {
  const now = 1700000000000;
  assert.equal(await stripeSignatureValid(secret, body, 't=1700000000', now), false);
  assert.equal(await stripeSignatureValid(secret, body, 'v1=deadbeef', now), false);
  assert.equal(await stripeSignatureValid(secret, body, '', now), false);
});
