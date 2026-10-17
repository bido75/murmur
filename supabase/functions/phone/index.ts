// Record phone calls through a Murmur number (Twilio). Deploy with --no-verify-jwt: every route
// checks Twilio's signature. Point the number's "A call comes in" webhook at /phone/voice.
//   GET /info   → the number to call, if set up
//   /voice      → caller must be a linked number; asks for the PIN
//   /pin        → checks it (locks after 5 tries); asks for the number to call
//   /dial       → creates the recording, announces recording, bridges and records both sides
//   /announce   → notice played to the person called when they answer
//   /recording  → Twilio's recording callback: import, process, then delete it from Twilio
import { adminClient, corsHeaders, json } from '../_shared/services.ts';
import { callAllowed, keypadToE164, twimlAnnounce, twimlAskNumber, twimlAskPin, twimlDial, twimlReject, verifyTwilio } from '../_shared/phone.ts';
import { importAudioUrl } from '../_shared/import_audio.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const env = (k: string) => Deno.env.get(k) ?? '';
const base = () => `${env('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/phone`;
const xmlRes = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/xml' } });
const APP = () => env('APP_NAME') || 'Murmur';

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const route = u.pathname.split('/').pop() ?? '';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Public: the number to call (shown in the app).
  if (req.method === 'GET' && route === 'info') {
    const ready = Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_PHONE_NUMBER'));
    return json({ number: ready ? env('TWILIO_PHONE_NUMBER') : null, allowed: (Deno.env.get('PHONE_ALLOWED_PREFIXES') ?? '+1').split(',').map((s) => s.trim()) });
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  // Twilio signs the public URL it called, including the query string.
  const publicUrl = `${base()}/${route}${u.search}`;
  if (!(await verifyTwilio(env('TWILIO_AUTH_TOKEN'), publicUrl, params, req.headers.get('x-twilio-signature')))) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    switch (route) {
      case 'voice':
        return await voice(params);
      case 'pin':
        return await pin(params);
      case 'dial':
        return await dial(params, u.searchParams);
      case 'announce':
        return xmlRes(twimlAnnounce());
      case 'recording':
        return await recording(params, u.searchParams);
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('phone error', route, e);
    return route === 'recording' ? json({ ok: false }, 500) : xmlRes(twimlReject('Sorry, something went wrong. Please try again later.'));
  }
});

async function linked(from: string) {
  const { data } = await adminClient().from('phone_links').select('user_id').eq('phone_e164', from).maybeSingle();
  return data?.user_id as string | undefined;
}

async function voice(p: Record<string, string>) {
  if (!(await linked(p.From ?? ''))) return xmlRes(twimlReject(`This phone number isn't linked to a ${APP()} account. Link it in the app under Settings, Phone calls.`));
  return xmlRes(twimlAskPin(`${base()}/pin`, APP()));
}

async function pin(p: Record<string, string>) {
  const { data } = await adminClient().rpc('phone_pin_check', { phone: p.From ?? '', pin: p.Digits ?? '' });
  const r = (data as { user_id: string; ok: boolean; locked: boolean }[] | null)?.[0];
  if (!r) return xmlRes(twimlReject('This phone number is not linked.'));
  if (r.locked) return xmlRes(twimlReject('Too many wrong PINs. Try again in 30 minutes.'));
  if (!r.ok) return xmlRes(twimlAskPin(`${base()}/pin`, APP(), true));
  // The PIN step is bound to this call: /dial only accepts the CallSid that passed it.
  await adminClient().from('phone_links').update({ last_call_sid: p.CallSid }).eq('user_id', r.user_id);
  return xmlRes(twimlAskNumber(`${base()}/dial`));
}

async function dial(p: Record<string, string>, q: URLSearchParams) {
  const db = adminClient();
  const { data: l } = await db.from('phone_links').select('user_id, last_call_sid').eq('phone_e164', p.From ?? '').maybeSingle();
  if (!l || !p.CallSid || l.last_call_sid !== p.CallSid) return xmlRes(twimlReject('Please call again and enter your PIN.'));
  const to = keypadToE164(p.Digits ?? '', env('PHONE_DEFAULT_COUNTRY') || '1');
  const tries = Number(q.get('try') ?? 0);
  if (!to || !callAllowed(to, Deno.env.get('PHONE_ALLOWED_PREFIXES'))) {
    return tries >= 2 ? xmlRes(twimlReject('That number cannot be called from here. Goodbye.')) : xmlRes(twimlAskNumber(`${base()}/dial?try=${tries + 1}`, true));
  }
  const id = crypto.randomUUID();
  const { error } = await db.from('recordings').insert({
    id,
    user_id: l.user_id,
    title: `Call with ${to}`,
    template: 'phone_call',
    source: 'phone',
    status: 'recording',
    consent_method: 'phone_announced',
    consent_confirmed_at: new Date().toISOString(),
    external_ref: p.CallSid,
  });
  if (error) throw new Error(error.message);
  return xmlRes(twimlDial({ to, callerId: env('TWILIO_PHONE_NUMBER'), announceUrl: `${base()}/announce`, recordingCallback: `${base()}/recording?rid=${id}` }));
}

async function recording(p: Record<string, string>, q: URLSearchParams) {
  const rid = q.get('rid') ?? '';
  const db = adminClient();
  const { data: rec } = await db.from('recordings').select('id, user_id, external_ref, status').eq('id', rid).eq('source', 'phone').maybeSingle();
  if (!rec || rec.external_ref !== p.CallSid) return json({ ok: true }); // not ours, or a replay for another call
  if (p.RecordingStatus !== 'completed' || !p.RecordingUrl) {
    await db.from('recordings').update({ status: 'failed', error: 'The call ended before anything was recorded.' }).eq('id', rid);
    return json({ ok: true });
  }
  if (!['recording', 'failed'].includes(rec.status as string)) return json({ ok: true }); // already imported
  const auth = 'Basic ' + btoa(`${env('TWILIO_ACCOUNT_SID')}:${env('TWILIO_AUTH_TOKEN')}`);
  await db.from('recordings').update({ duration_ms: Math.round(Number(p.RecordingDuration ?? 0) * 1000), status: 'uploading' }).eq('id', rid);
  EdgeRuntime.waitUntil(
    (async () => {
      await importAudioUrl(rid, rec.user_id as string, `${p.RecordingUrl}.mp3`, { Authorization: auth });
      // Our copy is the only one kept: remove it from Twilio.
      await fetch(`${p.RecordingUrl}.json`, { method: 'DELETE', headers: { Authorization: auth } }).catch(() => undefined);
    })(),
  );
  return json({ ok: true });
}
