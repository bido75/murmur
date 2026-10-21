// Sharing. Deploy with --no-verify-jwt: /view is public (the share token is the key);
// the other routes check the signed-in user themselves.
//   GET  /view?token=…                    → public notes for a share link
//   GET  /reel?token=…                    → a public highlight reel: its clips, words and audio
//   POST /recap { recording_id, to, note } → email the notes (with a share link) to attendees
//   POST /docx  { recording_id, include_transcript } → Word file download URL
//   POST /ask   { token, question } (public; x-share-password if set) → answer from that recording
//   POST /followup { recording_id, tone } → { subject, body } email draft
import { adminClient, claudeStructured, claudeText, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { ASK_SYSTEM } from '../_shared/prompts.ts';
import { formatTranscript, type Utterance } from '../_shared/verify.ts';
import { FOLLOWUP_TOOL, followupMaterial, followupSystem } from '../_shared/followup.ts';
import { linkStatus, parseRecipients, publicNotes, recapEmail } from '../_shared/share.ts';
import { buildDocx } from '../_shared/docx.ts';

const APP_NAME = () => Deno.env.get('APP_NAME') ?? 'Murmur';
const appUrl = () => (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
const MAX_RECIPIENTS_PER_DAY = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith('/view') && req.method === 'GET') return await view(req);
    if (path.endsWith('/reel') && req.method === 'GET') return await reel(req);
    if (path.endsWith('/recap') && req.method === 'POST') return await recap(req);
    if (path.endsWith('/docx') && req.method === 'POST') return await docx(req);
    if (path.endsWith('/ask') && req.method === 'POST') return await askShared(req);
    if (path.endsWith('/followup') && req.method === 'POST') return await followup(req);
    if (path.endsWith('/email-available') && req.method === 'GET') return json({ available: Boolean(Deno.env.get('RESEND_API_KEY') && Deno.env.get('RECAP_FROM')) });
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('share error', e);
    return json({ error: (e as Error).message }, status);
  }
});

// deno-lint-ignore no-explicit-any
async function gather(db: any, recordingId: string, withTranscript: boolean) {
  const [{ data: rec }, { data: sum }, { data: tasks }, tr] = await Promise.all([
    db.from('recordings').select('id, user_id, title, created_at, duration_ms, template, status, consent_method, audio_deleted_at').eq('id', recordingId).maybeSingle(),
    db.from('summaries').select('overview, key_points, key_point_details, decisions, open_questions, site_log').eq('recording_id', recordingId).maybeSingle(),
    db.from('tasks').select('text, owner, due_text, status, needs_review').eq('recording_id', recordingId).order('created_at'),
    withTranscript ? db.from('transcripts').select('utterances, speaker_names').eq('recording_id', recordingId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return { rec, sum, tasks: tasks ?? [], transcript: tr.data };
}

/** Look up a share link by token and check it's usable (and the password, if it has one). */
// deno-lint-ignore no-explicit-any
async function openLink(db: any, req: Request, token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new HttpError(404, 'This link doesn’t exist.');
  const { data: link } = await db
    .from('share_links')
    .select('id, recording_id, include_transcript, revoked_at, expires_at, views, allow_audio, allow_questions, has_password, clip_start_ms, clip_end_ms, title')
    .eq('token', token)
    .maybeSingle();
  const status = linkStatus(link);
  if (status !== 'ok') {
    const msg = { missing: 'This link doesn’t exist.', revoked: 'This link was turned off by the person who shared it.', expired: 'This link has expired.' }[status];
    throw new HttpError(status === 'missing' ? 404 : 410, msg);
  }
  if (link.has_password) {
    const pw = req.headers.get('x-share-password');
    const { data: ok } = await db.rpc('share_password_ok', { tok: token, pw: pw ?? null });
    if (!ok) {
      if (pw) await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      throw new HttpError(401, pw ? 'That password isn’t right.' : 'This link is protected with a password.');
    }
  }
  return link as {
    id: string; recording_id: string; include_transcript: boolean; views: number; allow_audio: boolean; allow_questions: boolean;
    clip_start_ms: number | null; clip_end_ms: number | null; title: string | null;
  };
}

/** Signed audio for a shared recording: each part with where it starts on the timeline. */
// deno-lint-ignore no-explicit-any
async function sharedAudio(db: any, recordingId: string) {
  const { data: segs } = await db.from('recording_segments').select('storage_path, source_url, duration_ms').eq('recording_id', recordingId).order('idx');
  const out: { url: string; start_ms: number; duration_ms: number }[] = [];
  let start = 0;
  for (const s of (segs ?? []) as { storage_path: string | null; source_url: string | null; duration_ms: number }[]) {
    let url = s.source_url;
    if (s.storage_path) url = (await db.storage.from('audio').createSignedUrl(s.storage_path, 3 * 3600)).data?.signedUrl ?? null;
    if (url) out.push({ url, start_ms: start, duration_ms: s.duration_ms });
    start += s.duration_ms || 0;
  }
  return out;
}

async function view(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const db = adminClient();
  const link = await openLink(db, req, token);
  const clip = link.clip_start_ms != null ? { start_ms: link.clip_start_ms, end_ms: link.clip_end_ms!, title: link.title } : null;
  const { rec, sum, tasks, transcript } = await gather(db, link.recording_id, link.include_transcript || !!clip);
  if (!rec || rec.status !== 'ready') throw new HttpError(404, 'These notes aren’t ready yet.');
  await db.from('share_links').update({ views: (link.views ?? 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', link.id);

  const audioOk = (link.allow_audio || !!clip) && !rec.audio_deleted_at;
  const audio = audioOk ? await sharedAudio(db, rec.id) : [];

  if (clip) {
    // A clip shows only its moment: the words said in that range and the audio for it.
    const words = ((transcript?.utterances ?? []) as { start_ms: number; end_ms: number }[]).filter((u) => u.end_ms > clip.start_ms && u.start_ms < clip.end_ms);
    const notes = publicNotes({ recording: rec, summary: null, tasks: [], transcript: transcript ? { ...transcript, utterances: words } : null }, true);
    return json({ clip, notes: { ...notes, title: clip.title || rec.title }, audio, photos: [], can_ask: false, app: APP_NAME() });
  }

  // Photos from site walks (signed for an hour).
  const { data: photos } = await db.from('recording_photos').select('storage_path, caption, taken_ms').eq('recording_id', rec.id).order('taken_ms').limit(24);
  let photoUrls: { url: string; caption: string | null }[] = [];
  if (photos?.length) {
    const { data: signed } = await db.storage.from('photos').createSignedUrls(photos.map((p: { storage_path: string }) => p.storage_path), 3600);
    photoUrls = (signed ?? []).map((s, i) => ({ url: s.signedUrl ?? '', caption: photos[i].caption as string | null })).filter((p) => p.url);
  }
  return json({
    clip: null,
    notes: publicNotes({ recording: rec, summary: sum, tasks, transcript }, link.include_transcript),
    audio,
    photos: photoUrls,
    can_ask: link.allow_questions,
    app: APP_NAME(),
  });
}

/** Questions on a shared page, answered from that one recording only. 20 an hour per link. */
async function askShared(req: Request) {
  const { token, question } = await req.json();
  const q = String(question ?? '').trim().slice(0, 500);
  if (!q) throw new HttpError(400, 'Type a question.');
  const db = adminClient();
  const link = await openLink(db, req, String(token ?? ''));
  if (!link.allow_questions) throw new HttpError(403, 'Questions aren’t turned on for this link.');
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from('share_questions').select('id', { count: 'exact', head: true }).eq('link_id', link.id).gte('asked_at', since);
  if ((count ?? 0) >= 20) throw new HttpError(429, 'Too many questions on this link right now. Try again in an hour.');
  await db.from('share_questions').insert({ link_id: link.id });
  const { rec, transcript } = await gather(db, link.recording_id, true);
  if (!rec) throw new HttpError(404, 'Not found');
  const lines = formatTranscript((transcript?.utterances ?? []) as Utterance[], transcript?.speaker_names ?? {});
  const answer = await claudeText(ASK_SYSTEM, [
    { role: 'user', content: `Material:\n\n## ${rec.title} (${String(rec.created_at).slice(0, 10)})\n${lines}`.slice(0, 150_000) + `\n\nQuestion: ${q}` },
  ]);
  return json({ answer });
}

/** A follow-up email the organizer can edit and send, written only from confirmed notes. */
async function followup(req: Request) {
  const { client } = await requireUser(req);
  const { recording_id, tone } = await req.json();
  const { rec, sum, tasks } = await gather(client, recording_id, false);
  if (!rec) throw new HttpError(404, 'Recording not found');
  if (rec.status !== 'ready') throw new HttpError(400, 'Wait until the notes are ready.');
  const { data: me } = await client.auth.getUser();
  const n = publicNotes({ recording: rec, summary: sum, tasks }, false);
  const draft = await claudeStructured<{ subject: string; body: string }>(followupSystem(tone === 'formal' ? 'formal' : 'friendly'), [
    { role: 'user', content: followupMaterial(n, me.user?.email ?? null) },
  ], FOLLOWUP_TOOL);
  return json({ subject: String(draft.subject ?? '').slice(0, 200), body: String(draft.body ?? '').slice(0, 8000) });
}

async function recap(req: Request) {
  const { id: userId, client } = await requireUser(req);
  const { recording_id, to, note } = await req.json();
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RECAP_FROM');
  if (!key || !from) throw new HttpError(503, "Email isn't set up on the server yet (RESEND_API_KEY and RECAP_FROM).");
  const { valid, invalid } = parseRecipients(to ?? '');
  if (invalid.length) throw new HttpError(400, `Not an email address: ${invalid.slice(0, 3).join(', ')}`);
  if (!valid.length) throw new HttpError(400, 'Add at least one email address.');

  const { data: me } = await client.auth.getUser();
  const sender = me.user?.email ?? 'A colleague';
  const { rec, sum, tasks } = await gather(client, recording_id, false);
  if (!rec) throw new HttpError(404, 'Recording not found');
  if (rec.user_id !== userId) throw new HttpError(403, 'Only the person who made this recording can email its notes.');
  if (rec.status !== 'ready') throw new HttpError(400, 'Wait until the notes are ready.');

  const admin = adminClient();
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { data: recent } = await admin.from('recap_emails').select('recipients').eq('sent_by', userId).gte('sent_at', since);
  const sentToday = (recent ?? []).reduce((n: number, r: { recipients: string[] }) => n + r.recipients.length, 0);
  if (sentToday + valid.length > MAX_RECIPIENTS_PER_DAY) throw new HttpError(429, `You can email up to ${MAX_RECIPIENTS_PER_DAY} people a day.`);

  // A share link so people can open the full notes (reuse an active one).
  let link: string | null = null;
  if (appUrl()) {
    const { data: existing } = await client.from('share_links').select('token, revoked_at, expires_at').eq('recording_id', recording_id).is('revoked_at', null);
    const ok = (existing ?? []).find((l: { revoked_at: string | null; expires_at: string | null }) => linkStatus(l) === 'ok');
    const token = ok?.token ?? (await client.rpc('create_share_link', { rec: recording_id, with_transcript: false, valid_days: null })).data;
    if (token) link = `${appUrl()}/s/${token}`;
  }

  const dateLabel = new Date(rec.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const email = recapEmail(publicNotes({ recording: rec, summary: sum, tasks }, false), {
    appName: APP_NAME(),
    sender,
    link,
    note: typeof note === 'string' ? note.slice(0, 1000) : null,
    dateLabel,
  });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    // The sender gets the visible copy; attendees are BCC'd so nobody's address is exposed.
    body: JSON.stringify({ from, to: [me.user?.email ?? from.replace(/^.*<|>.*$/g, '')], bcc: valid, reply_to: me.user?.email, subject: email.subject, html: email.html, text: email.text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${body?.message ?? ''}`);
  await admin.from('recap_emails').insert({ recording_id, sent_by: userId, recipients: valid, provider_id: body?.id ?? null });
  return json({ sent: valid.length, link });
}

async function docx(req: Request) {
  const { id: userId, client } = await requireUser(req);
  const { recording_id, include_transcript } = await req.json();
  // Read as the user: anyone who can see the recording can export it.
  const { rec, sum, tasks, transcript } = await gather(client, recording_id, Boolean(include_transcript));
  if (!rec) throw new HttpError(404, 'Recording not found');
  const dateLabel = new Date(rec.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const consent: Record<string, string> = {
    told_everyone: 'told everyone at the start',
    in_invite: 'notice was in the invite',
    solo: 'only the recorder’s voice',
    consent_link: 'attendees agreed via consent link',
    bot_announced: 'notetaker announced itself in the meeting',
  };
  const bytes = await buildDocx(publicNotes({ recording: rec, summary: sum, tasks, transcript }, Boolean(include_transcript)), {
    appName: APP_NAME(),
    dateLabel,
    consent: consent[rec.consent_method] ?? null,
  });
  const safe = String(rec.title).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'notes';
  const filename = `${safe}.docx`;
  const path = `${userId}/${crypto.randomUUID()}/${filename}`;
  const admin = adminClient();
  const { error } = await admin.storage.from('exports').upload(path, bytes, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  if (error) throw new Error(error.message);
  const { data: signed } = await admin.storage.from('exports').createSignedUrl(path, 3600, { download: filename });
  return json({ url: signed?.signedUrl, filename });
}

/** A public highlight reel. Only clips the reel's creator may publish are returned (see public_reel_items). */
async function reel(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new HttpError(404, 'This reel doesn’t exist.');
  const db = adminClient();
  const { data: rows } = await db.rpc('public_reel_items', { tok: token });
  const items = (rows ?? []) as { title: string | null; playlist_title: string; recording_id: string; recording_title: string; created_at: string; start_ms: number; end_ms: number; audio_deleted: boolean }[];
  if (!items.length) {
    const { data: p } = await db.from('playlists').select('id').eq('share_token', token).maybeSingle();
    throw new HttpError(404, p ? 'This reel has no clips that can be shared.' : 'This reel was turned off or doesn’t exist.');
  }
  const audioCache = new Map<string, Awaited<ReturnType<typeof sharedAudio>>>();
  const trCache = new Map<string, { utterances: Utterance[]; speaker_names: Record<string, string> } | null>();
  const clips = [];
  for (const it of items.slice(0, 50)) {
    if (!audioCache.has(it.recording_id)) audioCache.set(it.recording_id, it.audio_deleted ? [] : await sharedAudio(db, it.recording_id));
    if (!trCache.has(it.recording_id)) trCache.set(it.recording_id, (await db.from('transcripts').select('utterances, speaker_names').eq('recording_id', it.recording_id).maybeSingle()).data);
    const tr = trCache.get(it.recording_id);
    const words = (tr?.utterances ?? []).filter((u) => u.end_ms > it.start_ms && u.start_ms < it.end_ms);
    const lines = publicNotes({ recording: { title: it.recording_title, created_at: it.created_at, duration_ms: 0, template: 'meeting' }, summary: null, tasks: [], transcript: tr ? { ...tr, utterances: words } : null }, true).transcript ?? [];
    clips.push({ title: it.title || it.recording_title, recording: it.recording_title, date: it.created_at, clip: { start_ms: it.start_ms, end_ms: it.end_ms }, audio: audioCache.get(it.recording_id), lines });
  }
  return json({ title: items[0].playlist_title, clips, app: APP_NAME() });
}
