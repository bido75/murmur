import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientUrl } from './services.ts';

test('clientUrl swaps only the host, keeping the path and the token', () => {
  Deno.env.set('EXTERNAL_SUPABASE_URL', 'http://10.0.0.180:54325');
  try {
    const out = clientUrl('http://kong:8000/storage/v1/object/sign/exports/a/b.pptx?token=abc');
    assert.equal(out, 'http://10.0.0.180:54325/storage/v1/object/sign/exports/a/b.pptx?token=abc');
  } finally {
    Deno.env.delete('EXTERNAL_SUPABASE_URL');
  }
});

test('clientUrl leaves the URL alone when no external address is set', () => {
  Deno.env.delete('EXTERNAL_SUPABASE_URL');
  const url = 'http://kong:8000/storage/v1/object/sign/x?token=abc';
  assert.equal(clientUrl(url), url);
});

test('clientUrl passes through null, undefined and empty', () => {
  assert.equal(clientUrl(null), null);
  assert.equal(clientUrl(undefined), undefined);
  assert.equal(clientUrl(''), '');
});

test('clientUrl keeps a trailing slash off the external address', () => {
  Deno.env.set('EXTERNAL_SUPABASE_URL', 'http://10.0.0.180:54325/');
  try {
    assert.equal(
      clientUrl('http://kong:8000/storage/v1/object/sign/x?token=abc'),
      'http://10.0.0.180:54325/storage/v1/object/sign/x?token=abc',
    );
  } finally {
    Deno.env.delete('EXTERNAL_SUPABASE_URL');
  }
});
