// RingCentral call recordings. Deploy with --no-verify-jwt: /callback is RingCentral's sign-in
// redirect, /hook/<key> its webhook (checked by the URL key and the verification token), /renew the
// daily schedule (CRON_SECRET); /start and /available check the user or nothing secret.
//   GET  /available           → { available }
//   POST /start { return_to } → { url }
//   GET  /callback            → saves the connection, subscribes to call events, back to the app
//   POST /hook/<key>          → a call ended: its recording is imported when RingCentral has it
//   POST /renew               → keeps every webhook subscription alive (daily)
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { isSafeReturn } from '../_shared/calendar.ts';
import { randomToken } from '../_shared/oauth.ts';
import { importAudioUrl } from '../_shared/import_audio.ts';
import { renewOnce } from '../_shared/token_lock.ts';
import { parseRcSession, rcAuthorizeUrl, rcCallTitle, rcServer, rcSubscriptionBody, rcTokenRequest, recordingFromCallLog, type RcSession } from '../_shared/ringcentral.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const env = (k: string) => Deno.env.get(k) ?? '';
const fnBase = () => `${env('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/ringcentral`;
const server = () => rcServer((k) => Deno.env.get(k));
const creds = () => ({ id: env('RINGCENTRAL_CLIENT_ID'), secret: env('RINGCENTRAL_CLIENT_SECRET') });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const i = parts.indexOf('ringcentral');
  const route = parts[i + 1] ?? '';
  try {
    if (route === 'hook' && req.method === 'POST') return await hook(req, parts[i + 2] ?? '');
    if (route === 'available') return json({ available: Boolean(creds().id && creds().secret) });
    if (route === 'start' && req.method === 'POST') return await start(req);
    if (route === 'callback' && req.method === 'GET') return await callback(req);
    if (route === 'renew' && req.method === 'POST') return await renewAll(req);
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('ringcentral error', e);
    return json({ error: (e as Error).message }, status);
  }
});

async function start(req: Request) {
  const { id: userId } = await requireUser(req);
  const { return_to } = await req.json();
  if (!creds().id) throw new HttpError(503, 'RingCentral isn’t set up on the server yet.');
  if (!return_to || !isSafeReturn(String(return_to), env('APP_URL'), env('APP_SCHEME') || 'murmur')) throw new HttpError(400, 'Invalid return address');
  const state = randomToken('rc_', 24);
  const { error } = await adminClient().from('integration_oauth_states').insert({ state, user_id: userId, provider: 'ringcentral', return_to });
  if (error) throw new Error(error.message);
  return json({ url: rcAuthorizeUrl(server(), creds().id, `${fnBase()}/callback`, state) });
}

async function tokenCall(body: Record<string, string>) {
  const t = rcTokenRequest(creds().id, creds().secret, body);
  const res = await fetch(`${server()}/restapi/oauth/token`, { method: 'POST', headers: t.headers, body: t.body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`RingCentral sign-in failed (${res.status})`);
  return j as { access_token: string; refresh_token: string; expires_in: number };
}

async function saveTokens(userId: string, t: { access_token: string; refresh_token: string; expires_in: number }) {
  await adminClient()
    .from('integrations')
    .update({ secret: t.refresh_token, access_secret: t.access_token, access_expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'ringcentral');
}

/** A fresh access token; refresh tokens rotate, so one renewal at a time. */
async function access(userId: string): Promise<string> {
  const db = adminClient();
  const { data: row } = await db.from('integrations').select('secret, access_secret, access_expires_at').eq('user_id', userId).eq('provider', 'ringcentral').maybeSingle();
  if (!row) throw new Error('RingCentral isn’t connected.');
  const fresh = (r: { access_secret: string | null; access_expires_at: string | null }) => Boolean(r.access_secret && r.access_expires_at && Date.parse(r.access_expires_at) - Date.now() > 60_000);
  if (fresh(row)) return row.access_secret as string;
  return await renewOnce(userId, 'ringcentral', fresh, async () => {
    const { data: latest } = await db.from('integrations').select('secret').eq('user_id', userId).eq('provider', 'ringcentral').single();
    const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: (latest?.secret ?? row.secret) as string });
    await saveTokens(userId, t);
    return t.access_token;
  });
}

async function rc<T>(userId: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${server()}${path}`, { ...init, headers: { Authorization: `Bearer ${await access(userId)}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`RingCentral ${path.split('?')[0]} failed (${res.status})`);
  return (await res.json()) as T;
}

async function subscribe(userId: string): Promise<string> {
  const db = adminClient();
  let { data: hook } = await db.from('inbound_hooks').select('key, verify_token').eq('user_id', userId).eq('provider', 'ringcentral').maybeSingle();
  if (!hook) {
    const ins = await db.from('inbound_hooks').insert({ user_id: userId, provider: 'ringcentral', verify_token: randomToken('', 24) }).select('key, verify_token').single();
    hook = ins.data;
  }
  const sub = await rc<{ id: string }>(userId, '/restapi/v1.0/subscription', { method: 'POST', body: JSON.stringify(rcSubscriptionBody(`${fnBase()}/hook/${hook!.key}`, hook!.verify_token as string)) });
  return sub.id;
}

async function callback(req: Request) {
  const q = new URL(req.url).searchParams;
  const db = adminClient();
  const { data: rows } = await db.from('integration_oauth_states').delete().eq('state', q.get('state') ?? '').select();
  const st = rows?.[0] as { user_id: string; return_to: string; expires_at: string } | undefined;
  if (!st || Date.parse(st.expires_at) < Date.now()) return new Response('That sign-in link expired. Go back to the app and try again.', { status: 400 });
  const back = (status: string) => {
    const u = new URL(st.return_to);
    u.searchParams.set('connected', `ringcentral:${status}`);
    return Response.redirect(u.toString(), 302);
  };
  if (q.get('error') || !q.get('code')) return back('cancelled');
  try {
    const t = await tokenCall({ grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: `${fnBase()}/callback` });
    await db.from('integrations').upsert(
      { user_id: st.user_id, provider: 'ringcentral', secret: t.refresh_token, access_secret: t.access_token, access_expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(), config: {} },
      { onConflict: 'user_id,provider' },
    );
    const me = await rc<{ name?: string; extensionNumber?: string }>(st.user_id, '/restapi/v1.0/account/~/extension/~');
    const subscriptionId = await subscribe(st.user_id);
    await db.from('integrations').update({ config: { account: me.name ?? `Ext. ${me.extensionNumber ?? ''}`.trim(), subscription_id: subscriptionId } }).eq('user_id', st.user_id).eq('provider', 'ringcentral');
    return back('ok');
  } catch (e) {
    console.error('ringcentral connect failed', (e as Error).message);
    return back('failed');
  }
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hook(req: Request, key: string) {
  // Subscription handshake: echo the token back.
  const validation = req.headers.get('validation-token');
  if (validation) return new Response(null, { status: 200, headers: { 'Validation-Token': validation } });
  const db = adminClient();
  const { data: h } = await db.from('inbound_hooks').select('user_id, verify_token').eq('key', key).eq('provider', 'ringcentral').maybeSingle();
  const token = req.headers.get('verification-token') ?? '';
  if (!h?.verify_token || !same(token, h.verify_token as string)) return json({ error: 'Forbidden' }, 403);
  const session = parseRcSession(await req.json().catch(() => null));
  if (!session?.ended) return json({ ok: true });
  const userId = h.user_id as string;
  const { data: conn } = await db.from('integrations').select('user_id').eq('user_id', userId).eq('provider', 'ringcentral').maybeSingle();
  if (!conn) return json({ ok: true });
  const id = crypto.randomUUID();
  const { error } = await db.from('recordings').insert({
    id,
    user_id: userId,
    title: rcCallTitle(session),
    template: 'phone_call',
    source: 'ringcentral',
    status: 'uploading',
    consent_method: 'provider_announced',
    external_ref: `rc:${session.sessionId}`,
  });
  if (error) return json({ ok: true, skipped: 'already imported' });
  EdgeRuntime.waitUntil(collect(id, userId, session));
  return json({ ok: true });
}

/** RingCentral finishes the recording a little after the call; ask the call log a few times. */
async function collect(id: string, userId: string, s: RcSession) {
  const db = adminClient();
  try {
    let found = null;
    for (let attempt = 0; !found && attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 15_000 : 30_000));
      const log = await rc<unknown>(userId, `/restapi/v1.0/account/~/extension/~/call-log?telephonySessionId=${encodeURIComponent(s.sessionId)}&view=Detailed&recordingType=All`).catch(() => null);
      found = recordingFromCallLog(log);
    }
    if (!found) {
      // Not every call is recorded (recording off, or the call was missed): drop the placeholder quietly.
      await db.from('recordings').delete().eq('id', id).eq('status', 'uploading');
      return;
    }
    await db.from('recordings').update({ duration_ms: found.durationSec * 1000, ...(found.startTime ? { created_at: found.startTime } : {}) }).eq('id', id);
    await importAudioUrl(id, userId, found.contentUri, { Authorization: `Bearer ${await access(userId)}` });
  } catch (e) {
    await db.from('recordings').update({ status: 'failed', error: (e as Error).message.slice(0, 300) }).eq('id', id);
  }
}

async function renewAll(req: Request) {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Forbidden' }, 403);
  const db = adminClient();
  const { data: rows } = await db.from('integrations').select('user_id, config').eq('provider', 'ringcentral');
  let renewed = 0;
  for (const r of rows ?? []) {
    const subId = (r.config as { subscription_id?: string }).subscription_id;
    try {
      if (subId) await rc(r.user_id as string, `/restapi/v1.0/subscription/${encodeURIComponent(subId)}/renew`, { method: 'POST' });
      else throw new Error('no subscription');
      renewed++;
    } catch {
      // Expired or missing: subscribe again.
      try {
        const id = await subscribe(r.user_id as string);
        await db.from('integrations').update({ config: { ...(r.config as object), subscription_id: id } }).eq('user_id', r.user_id).eq('provider', 'ringcentral');
        renewed++;
      } catch (e) {
        console.warn('ringcentral renew failed', r.user_id, (e as Error).message);
      }
    }
  }
  return json({ renewed });
}
