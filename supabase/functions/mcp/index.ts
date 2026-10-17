// MCP endpoint: POST JSON-RPC with `Authorization: Bearer mur_...` (a personal API token).
// Deploy with --no-verify-jwt: the token is ours, not a Supabase session.
//
// Access: the service client is used, so every query here is explicitly limited to what
// the token's user could see in the app: their own recordings plus those in projects of
// teams they belong to.
import { handle, type RpcRequest } from '../_shared/mcp.ts';
import { authenticate, makeSource } from '../_shared/mcp_source.ts';
import { protectedResourceMetadata, resourceMetadataUrl } from '../_shared/oauth.ts';
import { oauthConfig } from '../_shared/oauth_config.ts';
import { adminClient } from '../_shared/services.ts';

const SERVER_NAME = Deno.env.get('APP_NAME') ?? 'Murmur';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, ...(body === null ? {} : { 'Content-Type': 'application/json' }), ...extra },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const cfg = oauthConfig();

  // RFC 9728 protected resource metadata: tells clients which server issues tokens for us.
  if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return reply(protectedResourceMetadata(cfg.mcp, cfg.issuer));
  }
  // Streamable HTTP: we don't offer a server-to-client event stream.
  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405, { Allow: 'POST' });

  const unauthorized = (message: string) =>
    reply({ error: message }, 401, {
      'WWW-Authenticate': cfg.enabled
        ? `Bearer resource_metadata="${resourceMetadataUrl(cfg.mcp)}"`
        : 'Bearer',
    });

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return unauthorized('Missing access token');
  const db = adminClient();
  const userId = await authenticate(db, token, cfg.mcp);
  if (!userId) return unauthorized('Invalid, expired or revoked token');

  let body: RpcRequest | RpcRequest[];
  try {
    body = await req.json();
  } catch {
    return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const src = await makeSource(db, userId);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, src, SERVER_NAME)))).filter(Boolean);
    return out.length ? reply(out) : reply(null, 202);
  }
  const res = await handle(body, src, SERVER_NAME);
  return res ? reply(res) : reply(null, 202);
});

