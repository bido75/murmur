// OAuth 2.1 authorization server for MCP connectors (Claude.ai, ChatGPT, others).
// Deploy with --no-verify-jwt. Routes (by path suffix):
//   POST /register   dynamic client registration (RFC 7591)
//   GET  /client     validate an authorization request for the consent page
//   POST /approve    the signed-in user allows or denies (Supabase session required)
//   POST /token      authorization_code (PKCE) and refresh_token grants
//   POST /revoke     revoke a token (RFC 7009)
//   GET  /.well-known/oauth-authorization-server
import { adminClient, requireUser } from '../_shared/services.ts';
import {
  ACCESS_TTL_S, authorizationServerMetadata, canonicalResource, OAuthError, parseRegistration, pkceMatches,
  randomToken, redirectWith, REFRESH_TTL_S, registrationResponse, SCOPE, sha256Hex, validateAuthorize,
} from '../_shared/oauth.ts';
import { oauthConfig } from '../_shared/oauth_config.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}
const oauthError = (e: OAuthError) => json({ error: e.code, error_description: e.message }, e.status);

async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const b = await req.json();
    return Object.fromEntries(Object.entries(b ?? {}).map(([k, v]) => [k, String(v)]));
  }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const path = new URL(req.url).pathname;
  const cfg = oauthConfig();
  const db = adminClient();

  try {
    if (path.endsWith('/.well-known/oauth-authorization-server')) {
      return json(authorizationServerMetadata(cfg.endpoints));
    }

    if (!cfg.enabled) throw new OAuthError('temporarily_unavailable', 'Set the APP_URL secret to enable sign-in for AI connectors', 503);

    if (path.endsWith('/register') && req.method === 'POST') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new OAuthError('invalid_client_metadata', 'Body must be JSON');
      }
      const reg = parseRegistration(body);
      const clientId = randomToken('mcl_', 18);
      const { error } = await db.from('oauth_clients').insert({ client_id: clientId, client_name: reg.client_name, redirect_uris: reg.redirect_uris });
      if (error) throw new Error(error.message);
      return json(registrationResponse(clientId, reg, Math.floor(Date.now() / 1000)), 201);
    }

    if (path.endsWith('/client') && req.method === 'GET') {
      const params = Object.fromEntries(new URL(req.url).searchParams);
      const client = await loadClient(params.client_id);
      const ok = validateAuthorize(params, client, cfg.mcp);
      return json({ client_name: client!.client_name, redirect_host: new URL(ok.redirect_uri).host });
    }

    if (path.endsWith('/approve') && req.method === 'POST') {
      const { id: userId } = await requireUser(req);
      const body = await req.json();
      const params = (body.params ?? {}) as Record<string, string>;
      const client = await loadClient(params.client_id);
      const ok = validateAuthorize(params, client, cfg.mcp);
      if (body.decision !== 'allow') {
        return json({ redirect: redirectWith(ok.redirect_uri, { error: 'access_denied', state: ok.state, iss: cfg.issuer }) });
      }
      const code = randomToken('mac_', 32);
      const { error } = await db.from('oauth_codes').insert({
        code_hash: await sha256Hex(code),
        client_id: ok.client_id,
        user_id: userId,
        redirect_uri: ok.redirect_uri,
        code_challenge: ok.code_challenge,
        resource: ok.resource,
        scope: ok.scope,
      });
      if (error) throw new Error(error.message);
      return json({ redirect: redirectWith(ok.redirect_uri, { code, state: ok.state, iss: cfg.issuer }) });
    }

    if (path.endsWith('/token') && req.method === 'POST') {
      const p = await readParams(req);
      if (p.grant_type === 'authorization_code') return json(await exchangeCode(p, cfg.mcp));
      if (p.grant_type === 'refresh_token') return json(await refresh(p, cfg.mcp));
      throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
    }

    if (path.endsWith('/revoke') && req.method === 'POST') {
      const p = await readParams(req);
      if (p.token) {
        const hash = await sha256Hex(p.token);
        const { data } = await db.from('oauth_tokens').select('family, client_id').eq('token_hash', hash).maybeSingle();
        // RFC 7009: revoking a refresh token revokes its family; unknown tokens still get 200.
        if (data && (!p.client_id || p.client_id === data.client_id)) await db.from('oauth_tokens').delete().eq('family', data.family);
      }
      return new Response(null, { status: 200, headers: CORS });
    }

    return json({ error: 'not_found' }, 404);
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(e);
    if ((e as { status?: number }).status === 401) return json({ error: 'login_required', error_description: 'Sign in first' }, 401);
    console.error('oauth error', e);
    return json({ error: 'server_error', error_description: 'Something went wrong' }, 500);
  }

  async function loadClient(clientId: string | undefined) {
    if (!clientId) return null;
    const { data } = await db.from('oauth_clients').select('client_id, client_name, redirect_uris').eq('client_id', clientId).maybeSingle();
    return data as { client_id: string; client_name: string; redirect_uris: string[] } | null;
  }

  async function issue(row: { client_id: string; user_id: string; resource: string }, family: string) {
    const access = randomToken('mat_', 32);
    const refreshTok = randomToken('mrt_', 32);
    const now = Date.now();
    const { error } = await db.from('oauth_tokens').insert([
      { token_hash: await sha256Hex(access), kind: 'access', client_id: row.client_id, user_id: row.user_id, resource: row.resource, scope: SCOPE, family, expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
      { token_hash: await sha256Hex(refreshTok), kind: 'refresh', client_id: row.client_id, user_id: row.user_id, resource: row.resource, scope: SCOPE, family, expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
    ]);
    if (error) throw new Error(error.message);
    void db.from('oauth_clients').update({ last_used_at: new Date().toISOString() }).eq('client_id', row.client_id);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refreshTok, scope: SCOPE };
  }

  async function exchangeCode(p: Record<string, string>, mcp: string) {
    if (!p.code || !p.code_verifier || !p.client_id) throw new OAuthError('invalid_request', 'code, code_verifier and client_id are required');
    const { data } = await db.rpc('oauth_consume_code', { p_hash: await sha256Hex(p.code) });
    const row = (data ?? [])[0] as { client_id: string; user_id: string; redirect_uri: string; code_challenge: string; resource: string } | undefined;
    if (!row) throw new OAuthError('invalid_grant', 'The code is invalid, expired or already used');
    if (row.client_id !== p.client_id) throw new OAuthError('invalid_grant', 'The code was issued to another client');
    if (p.redirect_uri && p.redirect_uri !== row.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
    if (!(await pkceMatches(p.code_verifier, row.code_challenge))) throw new OAuthError('invalid_grant', 'PKCE verification failed');
    if (p.resource && canonicalResource(p.resource) !== row.resource) throw new OAuthError('invalid_target', 'resource does not match');
    if (row.resource !== mcp) throw new OAuthError('invalid_target', 'resource does not match');
    return issue(row, crypto.randomUUID());
  }

  async function refresh(p: Record<string, string>, mcp: string) {
    if (!p.refresh_token || !p.client_id) throw new OAuthError('invalid_request', 'refresh_token and client_id are required');
    const { data } = await db.rpc('oauth_use_refresh', { p_hash: await sha256Hex(p.refresh_token) });
    const row = (data ?? [])[0] as { client_id: string; user_id: string; resource: string; family: string } | undefined;
    if (!row) throw new OAuthError('invalid_grant', 'The refresh token is invalid, expired or already used');
    if (row.client_id !== p.client_id) throw new OAuthError('invalid_grant', 'The refresh token was issued to another client');
    if (p.resource && canonicalResource(p.resource) !== row.resource) throw new OAuthError('invalid_target', 'resource does not match');
    if (row.resource !== mcp) throw new OAuthError('invalid_target', 'resource does not match');
    return issue(row, row.family);
  }
});
