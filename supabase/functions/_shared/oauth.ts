// OAuth 2.1 authorization server logic for MCP connectors. Pure (Web Crypto only), unit-tested.
// Public clients only: every flow uses PKCE (S256); no client secrets.

export const ACCESS_TTL_S = 60 * 60; // 1 hour
export const REFRESH_TTL_S = 30 * 24 * 60 * 60; // 30 days
export const SCOPE = 'mcp';

export class OAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---------- crypto helpers ----------

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(prefix: string, bytes = 32): string {
  return prefix + base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PKCE S256: BASE64URL(SHA256(verifier)) must equal the stored challenge. */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  // RFC 7636: 43–128 chars from the unreserved set.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return timingSafeEqual(base64url(digest), challenge);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- URIs ----------

/** RFC 8707 canonical form: lowercase scheme and host, no trailing slash, no fragment. */
export function canonicalResource(u: string): string {
  const url = new URL(u);
  url.hash = '';
  let s = `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname}${url.search}`;
  if (s.endsWith('/') && url.pathname !== '/') s = s.slice(0, -1);
  if (url.pathname === '/' && !url.search) s = s.slice(0, -1);
  return s;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Allowed redirect URIs: https anywhere; http only on loopback; or a private-use
 * reverse-domain scheme for native apps (RFC 8252 §7.1, e.g. com.example.app:/cb).
 */
export function isAllowedRedirect(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'https') return true;
  if (scheme === 'http') return LOOPBACK.has(url.hostname.toLowerCase()) || LOOPBACK.has(`[${url.hostname}]`);
  if (['javascript', 'data', 'file', 'vbscript', 'blob', 'about', 'ftp', 'ws', 'wss'].includes(scheme)) return false;
  return /^[a-z][a-z0-9+\-]*(\.[a-z0-9+\-]+)+$/.test(scheme);
}

// ---------- Dynamic client registration (RFC 7591) ----------

export type Registration = { client_name: string; redirect_uris: string[] };

export function parseRegistration(body: unknown): Registration {
  if (!body || typeof body !== 'object') throw new OAuthError('invalid_client_metadata', 'Body must be a JSON object');
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must list 1 to 10 URIs');
  }
  for (const u of uris) {
    if (typeof u !== 'string' || u.length > 2000 || !isAllowedRedirect(u)) {
      throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${String(u).slice(0, 200)}`);
    }
  }
  const grants = (b.grant_types as string[] | undefined) ?? ['authorization_code'];
  if (!Array.isArray(grants) || grants.some((g) => !['authorization_code', 'refresh_token'].includes(g))) {
    throw new OAuthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported');
  }
  const responses = (b.response_types as string[] | undefined) ?? ['code'];
  if (!Array.isArray(responses) || responses.some((r) => r !== 'code')) {
    throw new OAuthError('invalid_client_metadata', 'Only response_type "code" is supported');
  }
  const name = typeof b.client_name === 'string' && b.client_name.trim() ? b.client_name.trim().slice(0, 80) : 'MCP client';
  return { client_name: name, redirect_uris: [...new Set(uris as string[])] };
}

export function registrationResponse(clientId: string, r: Registration, issuedAt: number) {
  return {
    client_id: clientId,
    client_id_issued_at: issuedAt,
    client_name: r.client_name,
    redirect_uris: r.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

// ---------- Authorization request ----------

export type AuthorizeRequest = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
  resource: string;
  scope: string;
};

/**
 * Validate the authorization request against the registered client. Errors about the
 * client or redirect URI must NOT redirect (open-redirect protection); the caller shows them.
 */
export function validateAuthorize(
  params: Record<string, string | undefined>,
  client: { client_id: string; redirect_uris: string[] } | null,
  mcpResource: string,
): AuthorizeRequest {
  if (!client) throw new OAuthError('invalid_client', 'Unknown client. Try connecting again from your AI app.');
  const redirect = params.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
  if (!redirect || !client.redirect_uris.includes(redirect)) {
    throw new OAuthError('invalid_request', 'The redirect address does not match what this app registered.');
  }
  if (params.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'response_type must be "code"');
  if (!params.code_challenge || !/^[A-Za-z0-9\-_]{43}$/.test(params.code_challenge)) {
    throw new OAuthError('invalid_request', 'A PKCE code_challenge is required');
  }
  if ((params.code_challenge_method ?? 'plain') !== 'S256') throw new OAuthError('invalid_request', 'code_challenge_method must be S256');
  let resource = canonicalResource(mcpResource);
  if (params.resource) {
    let asked: string;
    try {
      asked = canonicalResource(params.resource);
    } catch {
      throw new OAuthError('invalid_target', 'resource is not a valid URI');
    }
    if (asked !== resource) throw new OAuthError('invalid_target', 'This server only issues tokens for its own MCP endpoint');
    resource = asked;
  }
  return {
    client_id: client.client_id,
    redirect_uri: redirect,
    code_challenge: params.code_challenge,
    state: params.state ?? null,
    resource,
    scope: SCOPE,
  };
}

export function redirectWith(uri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url.toString();
}

// ---------- Discovery documents ----------

export function authorizationServerMetadata(o: { issuer: string; authorize: string; token: string; register: string; revoke: string }) {
  return {
    issuer: o.issuer,
    authorization_endpoint: o.authorize,
    token_endpoint: o.token,
    registration_endpoint: o.register,
    revocation_endpoint: o.revoke,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
  };
}

export function protectedResourceMetadata(resource: string, issuer: string) {
  return {
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
  };
}

/** Where a client should find the protected resource metadata for this MCP URL (RFC 9728 §3). */
export function resourceMetadataUrl(resource: string): string {
  const u = new URL(resource);
  const path = u.pathname === '/' ? '' : u.pathname;
  return `${u.origin}/.well-known/oauth-protected-resource${path}`;
}
