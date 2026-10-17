// Import Aircall calls. Deploy with --no-verify-jwt: /hook/<key> is called by Aircall and checked
// by the URL key plus Aircall's webhook token; the other routes check the signed-in user.
//   POST /setup                          → { webhook_url } (creates the URL key once)
//   POST /connect { api_id, api_token, webhook_token, only_mine } → checks the API key, saves it
//   POST /hook/<key>                     → Aircall call.ended events; the recording is imported
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { aircallTitle, parseAircall, type AircallCall } from '../_shared/phone.ts';
import { importAudioUrl } from '../_shared/import_audio.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const hookUrl = (key: string) => `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/functions/v1/aircall/hook/${key}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const i = parts.indexOf('aircall');
  const route = parts[i + 1] ?? '';
  try {
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');
    if (route === 'hook') return await hook(req, parts[i + 2] ?? '');
    if (route === 'setup') return await setup(req);
    if (route === 'connect') return await connect(req);
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('aircall error', e);
    return json({ error: (e as Error).message }, status);
  }
});

async function setup(req: Request) {
  const { client } = await requireUser(req);
  const { data: existing } = await client.from('inbound_hooks').select('key').eq('provider', 'aircall').maybeSingle();
  if (existing) return json({ webhook_url: hookUrl(existing.key as string) });
  const { data, error } = await client.from('inbound_hooks').insert({ provider: 'aircall' }).select('key').single();
  if (error) throw new HttpError(400, error.message);
  return json({ webhook_url: hookUrl(data.key as string) });
}

async function connect(req: Request) {
  const { id: userId, client } = await requireUser(req);
  const b = await req.json();
  const apiId = String(b.api_id ?? '').trim();
  const apiToken = String(b.api_token ?? '').trim();
  const webhookToken = String(b.webhook_token ?? '').trim();
  if (!apiId || !apiToken || !webhookToken) throw new HttpError(400, 'Enter the API ID, API token and webhook token.');
  const res = await fetch('https://api.aircall.io/v1/company', { headers: { Authorization: 'Basic ' + btoa(`${apiId}:${apiToken}`) } });
  if (!res.ok) throw new HttpError(400, 'Aircall didn’t accept that API ID and token.');
  const company = (await res.json().catch(() => ({})))?.company?.name ?? 'Aircall';
  const { error: hErr } = await client.from('inbound_hooks').update({ verify_token: webhookToken }).eq('provider', 'aircall');
  if (hErr) throw new HttpError(400, hErr.message);
  const { error } = await adminClient()
    .from('integrations')
    .upsert({ user_id: userId, provider: 'aircall', secret: `${apiId}:${apiToken}`, config: { account: company, only_mine: b.only_mine !== false } }, { onConflict: 'user_id,provider' });
  if (error) throw new HttpError(400, error.message);
  return json({ ok: true, account: company });
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hook(req: Request, key: string) {
  const db = adminClient();
  const { data: h } = await db.from('inbound_hooks').select('user_id, verify_token').eq('key', key).eq('provider', 'aircall').maybeSingle();
  const { event, token, call } = parseAircall(await req.json().catch(() => null));
  if (!h?.verify_token || !token || !same(token, h.verify_token as string)) return json({ error: 'Forbidden' }, 403);
  if (event !== 'call.ended' || !call) return json({ ok: true });
  const userId = h.user_id as string;
  const { data: conn } = await db.from('integrations').select('secret, config').eq('user_id', userId).eq('provider', 'aircall').maybeSingle();
  if (!conn) return json({ ok: true });
  if ((conn.config as { only_mine?: boolean }).only_mine !== false) {
    const { data: u } = await db.auth.admin.getUserById(userId);
    if (!call.userEmail || call.userEmail.toLowerCase() !== (u.user?.email ?? '').toLowerCase()) return json({ ok: true, skipped: 'not your call' });
  }
  if (call.durationSec < 5) return json({ ok: true, skipped: 'too short' });

  const id = crypto.randomUUID();
  const { error } = await db.from('recordings').insert({
    id,
    user_id: userId,
    title: aircallTitle(call),
    template: 'phone_call',
    source: 'aircall',
    status: 'uploading',
    consent_method: 'provider_announced',
    consent_confirmed_at: null,
    duration_ms: call.durationSec * 1000,
    external_ref: `aircall:${call.id}`,
    ...(call.startedAt ? { created_at: call.startedAt } : {}),
  });
  if (error) return json({ ok: true, skipped: 'already imported' }); // unique external_ref
  EdgeRuntime.waitUntil(collect(id, userId, call, conn.secret as string));
  return json({ ok: true });
}

/** The recording link can arrive a little after the call ends; ask the API a few times. */
async function collect(id: string, userId: string, call: AircallCall, secret: string) {
  let url = call.recordingUrl;
  for (let attempt = 0; !url && attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 30_000));
    const res = await fetch(`https://api.aircall.io/v1/calls/${encodeURIComponent(call.id)}`, { headers: { Authorization: 'Basic ' + btoa(secret) } });
    if (res.ok) {
      const rec = (await res.json())?.call?.recording;
      if (typeof rec === 'string' && rec.startsWith('https://')) url = rec;
    }
  }
  if (!url) {
    await adminClient().from('recordings').update({ status: 'failed', error: 'Aircall didn’t provide a recording for this call (recording may be off for this line).' }).eq('id', id);
    return;
  }
  await importAudioUrl(id, userId, url);
}
