// Procore connection and daily log. Deploy with --no-verify-jwt (Procore's redirect to
// /callback carries no session); the other routes check the user themselves.
//   POST /start      { return_to }      → { url } to open in the browser
//   GET  /callback   Procore redirect: exchanges the code, stores the tokens server-side
//   POST /daily-log  { recording_id, date? } → adds the site log to the chosen project's daily log (Notes)
import { adminClient, corsHeaders, HttpError, json, publicApiBaseUrl, requireUser } from '../_shared/services.ts';
import { isSafeReturn } from '../_shared/calendar.ts';
import { randomToken } from '../_shared/oauth.ts';
import { authorizeUrl, createNotesLog, requestToken, tokenRequest, whoAmI } from '../_shared/procore.ts';
import { env, loadProcore, procoreAccess } from '../_shared/procore_db.ts';
import { formatSiteLog, siteLogIsEmpty, type SiteLog } from '../_shared/field.ts';

const callbackUrl = () => `${publicApiBaseUrl()}/functions/v1/procore/callback`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith('/callback') && req.method === 'GET') return await callback(req);
    if (path.endsWith('/start') && req.method === 'POST') return await start(req);
    if (path.endsWith('/daily-log') && req.method === 'POST') return await dailyLog(req);
    if (path.endsWith('/available') && req.method === 'GET') {
      return json({ available: Boolean(Deno.env.get('PROCORE_CLIENT_ID') && Deno.env.get('PROCORE_CLIENT_SECRET')) });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('procore error', e);
    return json({ error: (e as Error).message }, status);
  }
});

async function start(req: Request) {
  const { id: userId } = await requireUser(req);
  const { return_to } = await req.json();
  const e = env();
  if (!return_to || !isSafeReturn(String(return_to), Deno.env.get('APP_URL') ?? '', Deno.env.get('APP_SCHEME') ?? 'murmur')) {
    throw new HttpError(400, 'Invalid return address');
  }
  const state = randomToken('ps_', 24);
  const { error } = await adminClient().from('integration_oauth_states').insert({ state, user_id: userId, provider: 'procore', return_to });
  if (error) throw new Error(error.message);
  return json({ url: authorizeUrl(e, callbackUrl(), state) });
}

async function callback(req: Request) {
  const q = new URL(req.url).searchParams;
  const db = adminClient();
  const { data: rows } = await db.from('integration_oauth_states').delete().eq('state', q.get('state') ?? '').select();
  const st = rows?.[0] as { user_id: string; return_to: string; expires_at: string } | undefined;
  if (!st || new Date(st.expires_at).getTime() < Date.now()) return page('That sign-in link expired. Go back to the app and try again.');

  const back = (status: string) => {
    const u = new URL(st.return_to);
    u.searchParams.set('procore', status);
    return Response.redirect(u.toString(), 302);
  };
  if (q.get('error') || !q.get('code')) return back('cancelled');

  try {
    const e = env();
    const tokens = await requestToken(e, tokenRequest(e, { code: q.get('code')!, redirectUri: callbackUrl() }));
    const account = await whoAmI(e, tokens.access_token).catch(() => 'Procore user');
    // Keep the chosen project if this is a reconnect.
    const { data: prev } = await db.from('integrations').select('config').eq('user_id', st.user_id).eq('provider', 'procore').maybeSingle();
    const { error } = await db.from('integrations').upsert(
      {
        user_id: st.user_id,
        provider: 'procore',
        secret: tokens.refresh_token,
        access_secret: tokens.access_token,
        access_expires_at: tokens.expires_at,
        config: { ...((prev?.config as Record<string, unknown>) ?? {}), account },
      },
      { onConflict: 'user_id,provider' },
    );
    if (error) throw new Error(error.message);
    return back('connected');
  } catch (err) {
    console.error('procore connect failed', (err as Error).message);
    return back('failed');
  }
}

function page(message: string) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:32px"><p>${message.replace(/</g, '&lt;')}</p></body>`, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function dailyLog(req: Request) {
  const { id: userId, client } = await requireUser(req);
  const { recording_id, date: localDate } = await req.json();
  if (!recording_id) throw new HttpError(400, 'recording_id is required');

  // Read as the user: anyone who can see the recording can send its log.
  const { data: rec } = await client.from('recordings').select('id, title, created_at').eq('id', recording_id).maybeSingle();
  if (!rec) throw new HttpError(404, 'Recording not found');
  const { data: sum } = await client.from('summaries').select('site_log, site_log_external').eq('recording_id', recording_id).maybeSingle();
  const log = sum?.site_log as SiteLog | null;
  if (siteLogIsEmpty(log)) throw new HttpError(400, 'This recording has no site log. Site logs are written for "Site walk" recordings.');
  const sent = (sum?.site_log_external as { procore?: { url: string } } | null)?.procore;
  if (sent?.url) return json({ url: sent.url, already: true });

  const row = await loadProcore(userId);
  if (!row) throw new HttpError(400, 'Connect Procore in Settings first');
  const target = (row.config.target as { id: string } | undefined)?.id;
  const token = await procoreAccess(userId, row);

  // The phone sends the recording's local date; the UTC date can be a day off in the evening.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(localDate ?? '')) ? String(localDate) : String(rec.created_at).slice(0, 10);
  const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '');
  const text = formatSiteLog(log!, { title: rec.title, date, link: appUrl ? `${appUrl}/recording/${rec.id}` : null });
  const created = await createNotesLog(env(), token, target ?? '', date, text);
  await adminClient().from('summaries').update({ site_log_external: { procore: created } }).eq('recording_id', recording_id);
  return json({ url: created.url });
}
