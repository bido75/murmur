import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteHost } from './client_url.ts';

test('rewriteHost swaps only the host, keeping the path and the token', () => {
  const out = rewriteHost(
    'http://kong:8000/storage/v1/object/sign/exports/a/b.pptx?token=abc',
    'http://10.0.0.180:54325',
  );
  assert.equal(out, 'http://10.0.0.180:54325/storage/v1/object/sign/exports/a/b.pptx?token=abc');
});

test('rewriteHost leaves the URL alone when no external address is set', () => {
  const url = 'http://kong:8000/storage/v1/object/sign/x?token=abc';
  assert.equal(rewriteHost(url, ''), url);
  assert.equal(rewriteHost(url, '   '), url);
});

test('rewriteHost keeps a trailing slash off the external address', () => {
  assert.equal(
    rewriteHost('http://kong:8000/storage/v1/object/sign/x?token=abc', 'http://10.0.0.180:54325/'),
    'http://10.0.0.180:54325/storage/v1/object/sign/x?token=abc',
  );
});

test('rewriteHost clears the source port when the external base has none', () => {
  // The 2026-10-30 export failure: kong:8000 rewritten onto a portless https
  // origin kept :8000, producing a dead link.
  assert.equal(
    rewriteHost('http://kong:8000/storage/v1/object/sign/notes/f.mp3?token=abc', 'https://notes.giscop.com'),
    'https://notes.giscop.com/storage/v1/object/sign/notes/f.mp3?token=abc',
  );
});

test('rewriteHost leaves a malformed URL alone rather than throwing', () => {
  assert.equal(rewriteHost('not-a-url', 'http://10.0.0.180:54325'), 'not-a-url');
});
