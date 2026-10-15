import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizationServerMetadata, base64url, canonicalResource, isAllowedRedirect, OAuthError, parseRegistration,
  pkceMatches, redirectWith, resourceMetadataUrl, validateAuthorize,
} from './oauth.ts';

const MCP = 'https://app.example.com/mcp';
const client = { client_id: 'c1', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] };

async function challengeFor(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

test('PKCE: matches an independent SHA-256 + base64url computation (Python hashlib)', async () => {
  const verifier = 'dBjftJeZ4CVP-mJ92K9DwvVXaEuBNCgQMlKsijZbnLM';
  assert.equal(await challengeFor(verifier), 'xymQhXKt9y_SHqnLo1VQiqzTIzaidLmFW95aJEExczE');
  assert.equal(await pkceMatches(verifier, 'xymQhXKt9y_SHqnLo1VQiqzTIzaidLmFW95aJEExczE'), true);
  assert.equal(await pkceMatches(verifier.slice(0, -1) + 'X', 'xymQhXKt9y_SHqnLo1VQiqzTIzaidLmFW95aJEExczE'), false);
  assert.equal(await pkceMatches('short', 'xymQhXKt9y_SHqnLo1VQiqzTIzaidLmFW95aJEExczE'), false);
});

test('redirect URIs: https, loopback http and reverse-domain schemes only', () => {
  for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect', 'http://localhost:6274/cb', 'http://127.0.0.1:9999/', 'com.example.app:/oauth']) {
    assert.equal(isAllowedRedirect(ok), true, ok);
  }
  for (const bad of ['http://evil.com/cb', 'javascript:alert(1)', 'data:text/html,x', 'https://x.com/cb#frag', 'myapp://cb', 'not a url', 'file:///etc/passwd']) {
    assert.equal(isAllowedRedirect(bad), false, bad);
  }
});

test('registration validates redirect URIs and grant types', () => {
  const r = parseRegistration({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], grant_types: ['authorization_code', 'refresh_token'] });
  assert.equal(r.client_name, 'Claude');
  assert.throws(() => parseRegistration({ redirect_uris: ['http://evil.com'] }), /not allowed/);
  assert.throws(() => parseRegistration({ redirect_uris: [] }), OAuthError);
  assert.throws(() => parseRegistration({ redirect_uris: ['https://a.com'], grant_types: ['client_credentials'] }), OAuthError);
});

test('authorize: exact redirect match, PKCE S256 required, resource must be this server', () => {
  const base = { response_type: 'code', client_id: 'c1', redirect_uri: client.redirect_uris[0], code_challenge: 'xymQhXKt9y_SHqnLo1VQiqzTIzaidLmFW95aJEExczE', code_challenge_method: 'S256', state: 'xyz', resource: 'HTTPS://App.Example.com/mcp/' };
  const ok = validateAuthorize(base, client, MCP);
  assert.equal(ok.resource, MCP);
  assert.equal(ok.state, 'xyz');
  assert.throws(() => validateAuthorize({ ...base, redirect_uri: 'https://claude.ai/other' }, client, MCP), /redirect/);
  assert.throws(() => validateAuthorize({ ...base, code_challenge_method: 'plain' }, client, MCP), /S256/);
  assert.throws(() => validateAuthorize({ ...base, code_challenge: undefined }, client, MCP), /PKCE/);
  assert.throws(() => validateAuthorize({ ...base, resource: 'https://other.example.com/mcp' }, client, MCP), /own MCP/);
  assert.throws(() => validateAuthorize(base, null, MCP), /Unknown client/);
  // Single registered redirect may be omitted.
  assert.equal(validateAuthorize({ ...base, redirect_uri: undefined }, client, MCP).redirect_uri, client.redirect_uris[0]);
});

test('canonical resource and metadata URLs', () => {
  assert.equal(canonicalResource('HTTPS://App.Example.com/mcp/'), 'https://app.example.com/mcp');
  assert.equal(canonicalResource('https://app.example.com/'), 'https://app.example.com');
  assert.equal(resourceMetadataUrl('https://app.example.com/mcp'), 'https://app.example.com/.well-known/oauth-protected-resource/mcp');
  const md = authorizationServerMetadata({ issuer: 'https://app.example.com', authorize: 'a', token: 't', register: 'r', revoke: 'v' });
  assert.deepEqual(md.code_challenge_methods_supported, ['S256']);
});

test('redirect builder keeps existing query and skips nulls', () => {
  assert.equal(redirectWith('https://c.com/cb?x=1', { code: 'abc', state: null }), 'https://c.com/cb?x=1&code=abc');
});
