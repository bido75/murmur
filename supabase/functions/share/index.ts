// Sharing. Deploy with --no-verify-jwt: /view is public (the share token is the key);
// the other routes check the signed-in user themselves.
//   GET  /view?token=…                    → public notes for a share link
//   POST /recap { recording_id, to, note } → email the notes (with a share link) to attendees
//   POST /docx  { recording_id, include_transcript } → Word file download URL
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
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
    if (path.endsWith('/recap') && req.method === 'POST') return await recap(req);
    if (path.endsWith('/docx') && req.method === 'POST') return await docx(req);
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
    db.from('recordings').select('id, user_id, title, created_at, duration_ms, template, status, consent_method').eq('id', recordingId).maybeSingle(),
    db.from('summaries').select('overview, key_points, decisions, open_questions, site_log').eq('recording_id', recordingId).maybeSingle(),
    db.from('tasks').select('text, owner, due_text, status, needs_review').eq('recording_id', recordingId).order('created_at'),
    withTranscript ? db.from('transcripts').select('utterances, speaker_names').eq('recording_id', recordingId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return { rec, sum, tasks: tasks ?? [], transcript: tr.data };
}

async function view(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new HttpError(404, 'This link doesn’t exist.');
  const db = adminClient();
  const { data: link } = await db.from('share_links').select('id, recording_id, include_transcript, revoked_at, expires_at, views').eq('token', token).maybeSingle();
  const status = linkStatus(link);
  if (status !== 'ok') {
    const msg = { missing: 'This link doesn’t exist.', revoked: 'This link was turned off by the person who shared it.', expired: 'This link has expired.' }[status];
    throw new HttpError(status === 'missing' ? 404 : 410, msg);
  }
  const { rec, sum, tasks, transcript } = await gather(db, link!.recording_id, link!.include_transcript);
  if (!rec || rec.status !== 'ready') throw new HttpError(404, 'These notes aren’t ready yet.');
  await db.from('share_links').update({ views: (link!.views ?? 0) + 1, last_viewed_at: new Date().toISOString() }).eq('id', link!.id);

  // Photos from site walks (signed for an hour).
  const { data: photos } = await db.from('recording_photos').select('storage_path, caption, taken_ms').eq('recording_id', rec.id).order('taken_ms').limit(24);
  let photoUrls: { url: string; caption: string | null }[] = [];
  if (photos?.length) {
    const { data: signed } = await db.storage.from('photos').createSignedUrls(photos.map((p: { storage_path: string }) => p.storage_path), 3600);
    photoUrls = (signed ?? []).map((s, i) => ({ url: s.signedUrl ?? '', caption: photos[i].caption as string | null })).filter((p) => p.url);
  }
  return json({ notes: publicNotes({ recording: rec, summary: sum, tasks, transcript }, link!.include_transcript), photos: photoUrls, app: APP_NAME() });
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
