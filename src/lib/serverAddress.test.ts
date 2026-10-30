import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSupabaseUrl } from './serverAddress.ts';

test('a server that is genuinely somewhere else is left alone', () => {
  assert.equal(
    resolveSupabaseUrl('https://abc.supabase.co', '10.0.0.180'),
    'https://abc.supabase.co',
  );
  assert.equal(
    resolveSupabaseUrl('https://example.com:54321', '10.0.0.180'),
    'https://example.com:54321',
  );
});

test('an address that is not an address is left alone', () => {
  assert.equal(resolveSupabaseUrl('not a url', '10.0.0.180'), 'not a url');
  assert.equal(resolveSupabaseUrl('', '10.0.0.180'), '');
});

test('an address that points at this computer becomes the name of the computer the app was served from', () => {
  // This is the case that made logging in from another machine fail: "127.0.0.1" meant
  // that other computer, where there is no server.
  assert.equal(
    resolveSupabaseUrl('http://127.0.0.1:54321', '10.0.0.180'),
    'http://10.0.0.180:54321',
  );
  assert.equal(
    resolveSupabaseUrl('http://localhost:54321', '10.0.0.180'),
    'http://10.0.0.180:54321',
  );
  assert.equal(
    resolveSupabaseUrl('http://0.0.0.0:54321', '10.0.0.180'),
    'http://10.0.0.180:54321',
  );
});

test('the port and the path are kept', () => {
  assert.equal(
    resolveSupabaseUrl('http://127.0.0.1:54321/rest', '10.0.0.180'),
    'http://10.0.0.180:54321/rest',
  );
});

test('a trailing slash is not doubled up', () => {
  assert.equal(
    resolveSupabaseUrl('http://127.0.0.1:54321/', '10.0.0.180'),
    'http://10.0.0.180:54321',
  );
});

test('with no name to use, the address is left alone', () => {
  // A phone, or a page opened from a file.
  assert.equal(
    resolveSupabaseUrl('http://127.0.0.1:54321', null),
    'http://127.0.0.1:54321',
  );
  assert.equal(
    resolveSupabaseUrl('http://127.0.0.1:54321', 'localhost'),
    'http://127.0.0.1:54321',
  );
});
