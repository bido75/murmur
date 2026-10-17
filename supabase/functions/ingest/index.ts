// Uploads from linked devices (browser extension, Apple Watch, Wear OS, desktop screen recording)
// and transcripts made on the phone. Deploy with --no-verify-jwt; every route checks its caller.
//   POST /link { code, name, kind }                     → { token }  (one-time code from the app)
//   POST /start { title?, template?, consent_method?, project_id?, video? }   → { recording_id }
//   POST /upload-url { recording_id, idx, content_type } → { url, path }  (PUT the file there)
//   POST /finish { recording_id, duration_ms, segments: [{ idx, ext, duration_ms }] }
//   POST /local-transcript { recording_id, utterances, duration_ms }  (signed-in app only)
// Device calls use `Authorization: Bearer mdv_…`; the app may also use its normal session.
import { adminClient, corsHeaders, HttpError, json, userClient } from '../_shared/services.ts';
import { sha256 } from '../_shared/mcp_source.ts';
import { cleanLocalTranscript, DEVICE_SOURCES, segmentPath, uploadType } from '../_shared/ingest.ts';
import { runPipeline } from '../_shared/pipeline.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONSENT = ['told_everyone', 'in_invite', 'solo', 'not_confirmed'];
const TEMPLATES = ['general', 'meeting', 'lecture', 'phone_call', 'site_walk', 'sales_call', 'interview'];

type Caller = { userId: string; device: { id: string; kind: keyof typeof DEVICE_SOURCES } | null };

async function caller(req: Request): Promise<Caller> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token.startsWith('mdv_')) {
    const db = adminClient();
    const { data } = await db.from('device_tokens').select('id, user_id, kind').eq('token_hash', await sha256(token)).maybeSingle();
    if (!data) throw new HttpError(401, 'This device was unlinked. Link it again from the app.');
    await db.from('device_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
    return { userId: data.user_id as string, device: { id: data.id as string, kind: data.kind as keyof typeof DEVICE_SOURCES } };
  }
  const { data, error } = await userClient(req).auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'Not signed in');
  return { userId: data.user.id, device: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const route = new URL(req.url).pathname.split('/').pop() ?? '';
  try {
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');
    const body = await req.json().catch(() => ({}));
    if (route === 'link') return await link(body);
    const c = await caller(req);
    if (route === 'start') return await start(c, body);
    if (route === 'upload-url') return await uploadUrl(c, body);
    if (route === 'finish') return await finish(c, body);
    if (route === 'local-transcript') return await localTranscript(c, body);
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('ingest error', route, e);
    return json({ error: (e as Error).message }, status);
  }
});

async function link(b: Record<string, unknown>) {
  const { data, error } = await adminClient().rpc('redeem_device_link', { code: String(b.code ?? ''), device_name: String(b.name ?? ''), device_kind: String(b.kind ?? 'other') });
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(400, 'That code is wrong or expired. Make a new one in the app.');
  return json({ token: data });
}

async function start(c: Caller, b: Record<string, unknown>) {
  const projectId = b.project_id && UUID.test(String(b.project_id)) ? String(b.project_id) : null;
  if (projectId) {
    // Only into projects the user can add to.
    const { data } = await adminClient().rpc('readable_projects', { uid: c.userId });
    if (!(data as { id: string }[] | null)?.some((p) => p.id === projectId)) throw new HttpError(403, 'Project not found');
  }
  const source = c.device ? DEVICE_SOURCES[c.device.kind] : b.video ? 'screen' : 'mic';
  const id = crypto.randomUUID();
  const { error } = await adminClient().from('recordings').insert({
    id,
    user_id: c.userId,
    title: String(b.title ?? '').trim().slice(0, 120) || (source === 'watch' ? 'Watch recording' : source === 'extension' ? 'Browser recording' : 'Recording'),
    template: TEMPLATES.includes(String(b.template)) ? String(b.template) : 'meeting',
    source,
    status: 'uploading',
    consent_method: CONSENT.includes(String(b.consent_method)) ? String(b.consent_method) : 'not_confirmed',
    consent_confirmed_at: CONSENT.includes(String(b.consent_method)) && b.consent_method !== 'not_confirmed' ? new Date().toISOString() : null,
    project_id: projectId,
    has_video: Boolean(b.video),
  });
  if (error) throw new HttpError(400, error.message);
  return json({ recording_id: id });
}

async function ownRecording(c: Caller, id: unknown) {
  if (!UUID.test(String(id ?? ''))) throw new HttpError(404, 'Recording not found');
  const { data } = await adminClient().from('recordings').select('id, user_id, status, source').eq('id', String(id)).maybeSingle();
  if (!data || data.user_id !== c.userId) throw new HttpError(404, 'Recording not found');
  return data as { id: string; user_id: string; status: string; source: string };
}

async function uploadUrl(c: Caller, b: Record<string, unknown>) {
  const rec = await ownRecording(c, b.recording_id);
  if (rec.status !== 'uploading') throw new HttpError(409, 'This recording is already finished.');
  const idx = Math.round(Number(b.idx));
  if (!(idx >= 1 && idx <= 2000)) throw new HttpError(400, 'Bad part number');
  const t = uploadType(String(b.content_type ?? ''));
  if (!t) throw new HttpError(400, 'Unsupported audio type');
  const path = segmentPath(c.userId, rec.id, idx, t.ext);
  const { data, error } = await adminClient().storage.from('audio').createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new Error(error?.message ?? 'No upload URL');
  return json({ url: data.signedUrl, path, content_type: t.type });
}

async function finish(c: Caller, b: Record<string, unknown>) {
  const rec = await ownRecording(c, b.recording_id);
  if (rec.status !== 'uploading') return json({ ok: true, already: true });
  const segs = (Array.isArray(b.segments) ? b.segments : []).slice(0, 2000) as { idx: number; ext: string; duration_ms?: number }[];
  if (!segs.length) throw new HttpError(400, 'No audio parts');
  const admin = adminClient();
  const rows = [];
  for (const s of segs) {
    const idx = Math.round(Number(s.idx));
    const ext = String(s.ext ?? '');
    if (!(idx >= 1 && idx <= 2000) || !/^(webm|ogg|m4a|aac|mp3|wav|mp4)$/.test(ext)) throw new HttpError(400, 'Bad part');
    rows.push({ recording_id: rec.id, user_id: c.userId, idx, storage_path: segmentPath(c.userId, rec.id, idx, ext), duration_ms: Math.max(0, Math.round(Number(s.duration_ms) || 0)) });
  }
  // Every part must actually be in storage.
  const { data: files } = await admin.storage.from('audio').list(`${c.userId}/${rec.id}`, { limit: 2100 });
  const have = new Set((files ?? []).map((f) => `${c.userId}/${rec.id}/${f.name}`));
  const missing = rows.filter((r) => !have.has(r.storage_path));
  if (missing.length) throw new HttpError(400, `Part ${missing[0].idx} hasn't finished uploading.`);
  const { error } = await admin.from('recording_segments').upsert(rows, { onConflict: 'recording_id,idx' });
  if (error) throw new Error(error.message);
  await admin.from('recordings').update({ status: 'transcribing', duration_ms: Math.max(0, Math.round(Number(b.duration_ms) || 0)) }).eq('id', rec.id);
  EdgeRuntime.waitUntil(runPipeline(rec.id));
  return json({ ok: true });
}

async function localTranscript(c: Caller, b: Record<string, unknown>) {
  if (c.device) throw new HttpError(403, 'Use the app for this.');
  const rec = await ownRecording(c, b.recording_id);
  if (!['uploading', 'recording', 'failed'].includes(rec.status)) throw new HttpError(409, 'This recording already has notes.');
  const utterances = cleanLocalTranscript(b.utterances);
  if (!utterances) throw new HttpError(400, 'The transcript was empty or malformed.');
  const admin = adminClient();
  const { error } = await admin.from('transcripts').upsert({ recording_id: rec.id, user_id: c.userId, utterances, text: utterances.map((u) => u.text).join(' ') });
  if (error) throw new Error(error.message);
  await admin
    .from('recordings')
    .update({ status: 'transcribing', transcribed_on_device: true, error: null, duration_ms: Math.max(0, Math.round(Number(b.duration_ms) || 0)) })
    .eq('id', rec.id);
  EdgeRuntime.waitUntil(runPipeline(rec.id));
  return json({ ok: true });
}
