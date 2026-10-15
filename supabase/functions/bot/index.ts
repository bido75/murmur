// Optional meeting bot (Recall.ai). Deploy with --no-verify-jwt: /webhook is called by Recall and
// checked by signature; the other routes check the signed-in user themselves.
//   POST /schedule { meeting_url, join_at?, title?, project_id?, event_key? } → { recording_id }
//   POST /cancel   { recording_id }
//   POST /webhook  Recall bot status events; on "done" the audio is copied in and processed
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { runPipeline } from '../_shared/pipeline.ts';
import {
  apiBase,
  audioDownloadUrl,
  botAnnouncement,
  createBotBody,
  firstRecordingId,
  meetingPlatform,
  parseBotEvent,
  recallEnv,
  statusForEvent,
  verifyWebhook,
  type RecallEnv,
} from '../_shared/recall.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const MAX_AUDIO_BYTES = 400 * 1024 * 1024;

function env(): RecallEnv {
  const e = recallEnv((k) => Deno.env.get(k));
  if (!e.apiKey) throw new HttpError(503, "The meeting bot isn't set up on the server yet (RECALL_API_KEY).");
  return e;
}

async function recall<T>(e: RecallEnv, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiBase(e)}${path}`, {
    ...init,
    headers: { Authorization: `Token ${e.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meeting bot service error (${res.status}): ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith('/webhook') && req.method === 'POST') return await webhook(req);
    if (path.endsWith('/schedule') && req.method === 'POST') return await schedule(req);
    if (path.endsWith('/cancel') && req.method === 'POST') return await cancel(req);
    if (path.endsWith('/available') && req.method === 'GET') return json({ available: Boolean(Deno.env.get('RECALL_API_KEY')) });
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('bot error', e);
    return json({ error: (e as Error).message }, status);
  }
});

async function schedule(req: Request) {
  const { id: userId, client } = await requireUser(req);
  const e = env();
  const body = await req.json();
  const meetingUrl = String(body.meeting_url ?? '').trim();
  if (!meetingPlatform(meetingUrl)) throw new HttpError(400, 'Paste a Zoom, Google Meet, Microsoft Teams or Webex meeting link.');
  const joinAt = body.join_at ? new Date(body.join_at) : null;
  if (joinAt && (!Number.isFinite(joinAt.getTime()) || joinAt.getTime() > Date.now() + 30 * 86400_000)) throw new HttpError(400, 'Choose a time within the next 30 days.');

  const { data: me } = await client.auth.getUser();
  const recordingId = crypto.randomUUID();
  // Created as the user, so the usual project permissions apply.
  const { error: recErr } = await client.from('recordings').insert({
    id: recordingId,
    user_id: userId,
    title: String(body.title ?? '').trim().slice(0, 120) || 'Meeting (notetaker)',
    template: 'meeting',
    source: 'bot',
    status: 'scheduled',
    consent_method: 'bot_announced',
    consent_confirmed_at: null,
    project_id: body.project_id || null,
    calendar_event_key: body.event_key || null,
  });
  if (recErr) throw new HttpError(400, recErr.message);

  const admin = adminClient();
  try {
    const bot = await recall<{ id: string }>(e, '/bot/', {
      method: 'POST',
      body: JSON.stringify(
        createBotBody({
          meetingUrl,
          joinAt: joinAt?.toISOString() ?? null,
          botName: e.botName,
          recordingId,
          userId,
          announcement: botAnnouncement(me.user?.email ?? null, Deno.env.get('APP_NAME') ?? 'Murmur'),
        }),
      ),
    });
    await admin.from('meeting_bots').insert({ user_id: userId, recording_id: recordingId, provider_bot_id: bot.id, meeting_url: meetingUrl, join_at: joinAt?.toISOString() ?? null });
  } catch (err) {
    await admin.from('recordings').delete().eq('id', recordingId);
    throw err;
  }
  return json({ recording_id: recordingId });
}

async function cancel(req: Request) {
  const { id: userId } = await requireUser(req);
  const { recording_id } = await req.json();
  const admin = adminClient();
  const { data: b } = await admin.from('meeting_bots').select('provider_bot_id, status, user_id').eq('recording_id', recording_id).maybeSingle();
  if (!b || b.user_id !== userId) throw new HttpError(404, 'Notetaker not found');
  const e = env();
  if (b.status === 'scheduled') {
    await recall(e, `/bot/${b.provider_bot_id}/`, { method: 'DELETE' });
  } else {
    // Already joined: ask it to leave; whatever was recorded is still processed.
    await recall(e, `/bot/${b.provider_bot_id}/leave_call/`, { method: 'POST' });
  }
  await admin.from('meeting_bots').update({ status: b.status === 'scheduled' ? 'cancelled' : 'leaving' }).eq('recording_id', recording_id);
  if (b.status === 'scheduled') await admin.from('recordings').update({ status: 'cancelled' }).eq('id', recording_id);
  return json({ ok: true });
}

async function webhook(req: Request) {
  const raw = await req.text();
  const e = recallEnv((k) => Deno.env.get(k));
  try {
    await verifyWebhook(req.headers, raw, e.webhookSecret);
  } catch (err) {
    return json({ error: (err as Error).message }, 401);
  }
  const ev = parseBotEvent(JSON.parse(raw));
  const next = statusForEvent(ev);
  if (!ev.botId || !next) return json({ ok: true }); // events we don't track

  const admin = adminClient();
  const { data: b } = await admin.from('meeting_bots').select('recording_id, user_id, status').eq('provider_bot_id', ev.botId).maybeSingle();
  if (!b) return json({ ok: true });
  if (b.status === 'cancelled') return json({ ok: true });
  await admin.from('meeting_bots').update({ status: next.status, status_detail: next.detail }).eq('provider_bot_id', ev.botId);

  if (['joining', 'waiting_room', 'in_call', 'recording'].includes(next.status)) {
    await admin.from('recordings').update({ status: 'recording' }).eq('id', b.recording_id).in('status', ['scheduled', 'recording']);
  } else if (next.status === 'denied' || (next.status === 'failed' && ev.event === 'bot.fatal')) {
    // A fatal error mid-call is followed by bot.done with partial media; only fail if nothing comes.
    await admin.from('recordings').update({ error: next.detail }).eq('id', b.recording_id);
  } else if (next.status === 'done') {
    // Respond quickly; copy the audio and process in the background.
    EdgeRuntime.waitUntil(collect(ev.botId, b.recording_id, b.user_id));
  }
  return json({ ok: true });
}

/** Copy the finished recording into our storage (Recall's links expire) and run the pipeline. */
async function collect(botId: string, recordingId: string, userId: string) {
  const admin = adminClient();
  try {
    const e = env();
    const bot = await recall<unknown>(e, `/bot/${botId}/`);
    const recId = firstRecordingId(bot);
    const mixed = recId ? await recall<unknown>(e, `/audio_mixed/?recording_id=${encodeURIComponent(recId)}`).catch(() => ({})) : {};
    const url = audioDownloadUrl(bot, mixed);
    if (!url) throw new Error('The notetaker finished but no recording was produced (it may not have been let in).');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't download the recording (${res.status})`);
    const size = Number(res.headers.get('content-length') ?? 0);
    if (size > MAX_AUDIO_BYTES) throw new Error('The recording is too large to import.');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isVideo = (res.headers.get('content-type') ?? '').includes('video') || /\.mp4(\?|$)/.test(url);
    const ext = isVideo ? 'mp4' : 'mp3';
    const path = `${userId}/${recordingId}/seg-0001.${ext}`;
    const { error: upErr } = await admin.storage.from('audio').upload(path, bytes, { contentType: isVideo ? 'video/mp4' : 'audio/mpeg', upsert: true });
    if (upErr) throw new Error(upErr.message);
    await admin.from('recording_segments').upsert({ recording_id: recordingId, user_id: userId, idx: 1, storage_path: path, duration_ms: 0 }, { onConflict: 'recording_id,idx' });
    await admin.from('recordings').update({ status: 'transcribing', error: null }).eq('id', recordingId);
    await runPipeline(recordingId);
  } catch (err) {
    console.error('bot collect failed', recordingId, err);
    await admin.from('recordings').update({ status: 'failed', error: (err as Error).message.slice(0, 500) }).eq('id', recordingId);
  }
}
