// Calendar sync (Google Calendar, Microsoft 365). Deploy with --no-verify-jwt (the provider
// redirect to /callback carries no session); other routes check the user themselves.
//   POST /start     { provider, return_to } → { url } to open in the browser
//   GET  /callback  provider redirect: exchanges the code, stores the refresh token
//   POST /events    { days? } → upcoming meetings from all connected calendars, with project matches
// Refresh tokens are stored server-side only (see the calendar_connections column grants).
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { isSafeReturn, matchProject, normalizeGoogle, normalizeGraph, sortAndFilter, type CalendarEvent, type CalProvider } from '../_shared/calendar.ts';
import { randomToken } from '../_shared/oauth.ts';

const PROVIDERS: Record<CalProvider, { auth: string; token: string; scope: string; idEnv: string; secretEnv: string }> = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
    idEnv: 'GOOGLE_CLIENT_ID',
    secretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  microsoft: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email offline_access User.Read Calendars.Read',
    idEnv: 'MICROSOFT_CLIENT_ID',
    secretEnv: 'MICROSOFT_CLIENT_SECRET',
  },
};

const callbackUrl = () => `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/functions/v1/calendar/callback`;
const creds = (p: CalProvider) => ({ id: Deno.env.get(PROVIDERS[p].idEnv) ?? '', secret: Deno.env.get(PROVIDERS[p].secretEnv) ?? '' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith('/callback') && req.method === 'GET') return await callback(req);
    if (path.endsWith('/start') && req.method === 'POST') return await start(req);
    if (path.endsWith('/events') && req.method === 'POST') return await events(req);
    if (path.endsWith('/providers') && req.method === 'GET') {
      // Which providers the server has credentials for (so the app only offers those).
      return json({ providers: (Object.keys(PROVIDERS) as CalProvider[]).filter((p) => creds(p).id && creds(p).secret) });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('calendar error', e);
    return json({ error: (e as Error).message }, status);
  }
});

async function start(req: Request) {
  const { id: userId } = await requireUser(req);
  const { provider, return_to } = await req.json();
  if (!(provider in PROVIDERS)) throw new HttpError(400, 'Unknown calendar provider');
  const c = creds(provider);
  if (!c.id || !c.secret) throw new HttpError(503, `${provider === 'google' ? 'Google' : 'Microsoft'} calendar isn't set up on the server yet.`);
  const appUrl = Deno.env.get('APP_URL') ?? '';
  const scheme = Deno.env.get('APP_SCHEME') ?? 'murmur';
  if (!return_to || !isSafeReturn(String(return_to), appUrl, scheme)) throw new HttpError(400, 'Invalid return address');

  const state = randomToken('cs_', 24);
  const { error } = await adminClient().from('calendar_oauth_states').insert({ state, user_id: userId, provider, return_to });
  if (error) throw new Error(error.message);

  const p = PROVIDERS[provider as CalProvider];
  const url = new URL(p.auth);
  url.search = new URLSearchParams({
    client_id: c.id,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: p.scope,
    state,
    ...(provider === 'google' ? { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } : { prompt: 'select_account' }),
  }).toString();
  return json({ url: url.toString() });
}

async function callback(req: Request) {
  const q = new URL(req.url).searchParams;
  const db = adminClient();
  const state = q.get('state') ?? '';
  const { data: rows } = await db.from('calendar_oauth_states').delete().eq('state', state).select();
  const st = rows?.[0] as { user_id: string; provider: CalProvider; return_to: string; expires_at: string } | undefined;
  if (!st || new Date(st.expires_at).getTime() < Date.now()) return page('That sign-in link expired. Go back to the app and try again.');

  const back = (status: string) => {
    const u = new URL(st.return_to);
    u.searchParams.set('calendar', status);
    return Response.redirect(u.toString(), 302);
  };
  if (q.get('error') || !q.get('code')) return back('cancelled');

  const c = creds(st.provider);
  const res = await fetch(PROVIDERS[st.provider].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: q.get('code')!,
      redirect_uri: callbackUrl(),
      client_id: c.id,
      client_secret: c.secret,
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.refresh_token) {
    console.error('calendar token exchange failed', res.status, tok?.error);
    return back('failed');
  }
  const email = emailFromIdToken(tok.id_token);
  const { error } = await db.from('calendar_connections').upsert(
    { user_id: st.user_id, provider: st.provider, refresh_token: tok.refresh_token, account_email: email },
    { onConflict: 'user_id,provider' },
  );
  if (error) {
    console.error('calendar save failed', error.message);
    return back('failed');
  }
  return back('connected');
}

/** Read the email claim from an ID token we just received directly from the provider over TLS. */
function emailFromIdToken(idToken?: string): string | null {
  try {
    const payload = JSON.parse(atob(idToken!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.email ?? payload.preferred_username ?? null;
  } catch {
    return null;
  }
}

function page(message: string) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:32px"><p>${message.replace(/</g, '&lt;')}</p></body>`, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function accessToken(provider: CalProvider, refreshToken: string, userId: string): Promise<string | null> {
  const c = creds(provider);
  const res = await fetch(PROVIDERS[provider].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.id, client_secret: c.secret, scope: PROVIDERS[provider].scope }),
  });
  const tok = await res.json();
  if (!res.ok) {
    console.error('calendar refresh failed', provider, res.status, tok?.error);
    return null;
  }
  // Microsoft rotates refresh tokens; keep the newest.
  if (tok.refresh_token && tok.refresh_token !== refreshToken) {
    await adminClient().from('calendar_connections').update({ refresh_token: tok.refresh_token }).eq('user_id', userId).eq('provider', provider);
  }
  return tok.access_token;
}

async function events(req: Request) {
  const { id: userId, client } = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const days = Math.max(1, Math.min(14, Number(body.days) || 7));
  const now = new Date();
  const until = new Date(now.getTime() + days * 86400_000);

  const db = adminClient();
  const { data: conns } = await db.from('calendar_connections').select('provider, refresh_token, account_email').eq('user_id', userId);
  if (!conns?.length) return json({ connected: [], events: [] });

  const all: (CalendarEvent | null)[] = [];
  const problems: string[] = [];
  for (const conn of conns as { provider: CalProvider; refresh_token: string; account_email: string | null }[]) {
    if (!creds(conn.provider).id) continue;
    const at = await accessToken(conn.provider, conn.refresh_token, userId);
    if (!at) {
      problems.push(conn.provider);
      continue;
    }
    if (conn.provider === 'google') {
      const u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      u.search = new URLSearchParams({ timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' }).toString();
      const r = await fetch(u, { headers: { Authorization: `Bearer ${at}` } });
      if (!r.ok) { problems.push('google'); continue; }
      all.push(...((await r.json()).items ?? []).map(normalizeGoogle));
    } else {
      const u = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
      u.search = new URLSearchParams({
        startDateTime: now.toISOString(),
        endDateTime: until.toISOString(),
        $top: '50',
        $orderby: 'start/dateTime',
        $select: 'id,subject,start,end,isAllDay,isCancelled,seriesMasterId,type,attendees,onlineMeeting,onlineMeetingUrl,location,bodyPreview',
      }).toString();
      const r = await fetch(u, { headers: { Authorization: `Bearer ${at}`, Prefer: 'outlook.timezone="UTC"' } });
      if (!r.ok) { problems.push('microsoft'); continue; }
      all.push(...((await r.json()).value ?? []).map((e: Parameters<typeof normalizeGraph>[0]) => normalizeGraph(e, conn.account_email)));
    }
  }

  // Attach the matching project (explicit links first, then by name), using the user's own access.
  const [{ data: links }, { data: projects }] = await Promise.all([
    client.from('calendar_links').select('event_key, project_id'),
    client.from('projects').select('id, name').eq('archived', false),
  ]);
  const linkMap = Object.fromEntries((links ?? []).map((l: { event_key: string; project_id: string }) => [l.event_key, l.project_id]));
  const list = sortAndFilter(all, now).map((e) => ({ ...e, match: matchProject(e, linkMap, (projects ?? []) as { id: string; name: string }[]) }));

  return json({ connected: conns.map((c) => ({ provider: c.provider, email: c.account_email })), problems, events: list });
}
