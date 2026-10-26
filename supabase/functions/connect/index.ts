// Sign-in connections for Slack, Salesforce, Google Docs and OneNote. Deploy with
// --no-verify-jwt (the provider's redirect to /callback carries no session).
//   GET  /available            → which of them the server has app credentials for
//   POST /start { provider, return_to } → { url }
//   GET  /callback             → stores the connection, sends the user back to the app
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { isSafeReturn } from '../_shared/calendar.ts';
import { randomToken } from '../_shared/oauth.ts';
import { authorizeUrl, codeExchangeBody, OAUTH_PROVIDERS, providerConf, storedConnection, type OAuthProvider } from '../_shared/oauth_providers.ts';

const callbackUrl = () => `${((Deno.env.get('EXTERNAL_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, ''))}/functions/v1/connect/callback`;
const creds = (p: OAuthProvider) => {
  const c = providerConf(p, (k) => Deno.env.get(k));
  return { conf: c, id: Deno.env.get(c.idEnv) ?? '', secret: Deno.env.get(c.secretEnv) ?? '' };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith('/available') && req.method === 'GET') return json({ providers: OAUTH_PROVIDERS.filter((p) => creds(p).id && creds(p).secret) });
    if (path.endsWith('/start') && req.method === 'POST') return await start(req);
    if (path.endsWith('/callback') && req.method === 'GET') return await callback(req);
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('connect error', e);
    return json({ error: (e as Error).message }, status);
  }
});

async function start(req: Request) {
  const { id: userId } = await requireUser(req);
  const { provider, return_to } = await req.json();
  if (!OAUTH_PROVIDERS.includes(provider)) throw new HttpError(400, 'Unknown connection');
  const c = creds(provider);
  if (!c.id || !c.secret) throw new HttpError(503, 'This connection isn’t set up on the server yet.');
  if (!return_to || !isSafeReturn(String(return_to), Deno.env.get('APP_URL') ?? '', Deno.env.get('APP_SCHEME') ?? 'murmur')) throw new HttpError(400, 'Invalid return address');
  const state = randomToken('cn_', 24);
  const { error } = await adminClient().from('integration_oauth_states').insert({ state, user_id: userId, provider, return_to });
  if (error) throw new Error(error.message);
  return json({ url: authorizeUrl(c.conf, c.id, callbackUrl(), state) });
}

async function callback(req: Request) {
  const q = new URL(req.url).searchParams;
  const db = adminClient();
  const { data: rows } = await db.from('integration_oauth_states').delete().eq('state', q.get('state') ?? '').select();
  const st = rows?.[0] as { user_id: string; provider: OAuthProvider; return_to: string; expires_at: string } | undefined;
  if (!st || new Date(st.expires_at).getTime() < Date.now()) {
    return new Response('<p style="font-family:system-ui;padding:32px">That sign-in link expired. Go back to the app and try again.</p>', { status: 400, headers: { 'Content-Type': 'text/html' } });
  }
  const back = (status: string) => {
    const u = new URL(st.return_to);
    u.searchParams.set('connected', `${st.provider}:${status}`);
    return Response.redirect(u.toString(), 302);
  };
  if (q.get('error') || !q.get('code')) return back('cancelled');
  try {
    const c = creds(st.provider);
    const res = await fetch(c.conf.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: codeExchangeBody(c.id, c.secret, q.get('code')!, callbackUrl()),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`token exchange ${res.status}`);
    const conn = storedConnection(st.provider, body);
    const { data: prev } = await db.from('integrations').select('config').eq('user_id', st.user_id).eq('provider', st.provider).maybeSingle();
    const { error } = await db.from('integrations').upsert(
      {
        user_id: st.user_id,
        provider: st.provider,
        secret: conn.secret,
        access_secret: conn.access ?? null,
        access_expires_at: conn.access ? new Date(Date.now() + (conn.expiresIn ?? 3600) * 1000).toISOString() : null,
        config: { ...((prev?.config as Record<string, unknown>) ?? {}), ...conn.config },
      },
      { onConflict: 'user_id,provider' },
    );
    if (error) throw new Error(error.message);
    return back('ok');
  } catch (e) {
    console.error('connect callback failed', st.provider, (e as Error).message);
    return back('failed');
  }
}
