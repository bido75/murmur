import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateHost } from './ssrf.ts';

test('private and reserved IPv4 hosts are blocked', () => {
  for (const h of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.20', '169.254.169.254', '0.0.0.0', '224.0.0.1', '100.64.0.1', '198.18.0.1']) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('public IPv4 hosts are allowed', () => {
  for (const h of ['8.8.8.8', '1.1.1.1', '104.18.3.115', '216.200.21.203']) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test('internal hostnames are blocked', () => {
  for (const h of ['localhost', 'localhost.localdomain', 'foo.local', 'bar.internal', 'kong', 'x.localhost']) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('ordinary public hostnames are allowed', () => {
  for (const h of ['hooks.example.com', 'api.slack.com', 'notes.giscop.com', 'app.internal.example']) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test('IPv6 private forms are blocked', () => {
  for (const h of ['::1', '[::1]', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('a public IPv4-mapped IPv6 is allowed', () => {
  assert.equal(isPrivateHost('::ffff:8.8.8.8'), false);
});

test('a bare host is treated as private; an unparseable dotted name is allowed', () => {
  assert.equal(isPrivateHost(''), true);
  // Not a valid IP (octet > 255) and not single-label, so it is left for the
  // delivery-time resolver to judge rather than incorrectly blocked here.
  assert.equal(isPrivateHost('999.999.999.999'), false);
});