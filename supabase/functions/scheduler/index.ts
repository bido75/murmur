// Scheduled jobs. Deploy with --no-verify-jwt; called by pg_cron with `x-cron-secret`.
//   POST /scheduler?job=autobot  (every 10 minutes) send notetakers to upcoming calendar meetings
//   POST /scheduler?job=digest   (hourly) weekly digest emails at Monday 8am in each user's time zone
import { adminClient, json } from '../_shared/services.ts';
import { fetchEvents } from '../_shared/calendar_fetch.ts';
import { createBot } from '../_shared/bot_core.ts';
import { digestEmail, meetingsToJoin, type DigestData } from '../_shared/connect.ts';
import { meetingPlatform } from '../_shared/recall.ts';
import { isDigestTime } from '../_shared/digest_time.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Forbidden' }, 403);
  const job = new URL(req.url).searchParams.get('job');
  try {
    if (job === 'autobot') return json(await autobot());
    if (job === 'digest') return json(await digest());
    return json({ error: 'Unknown job' }, 400);
  } catch (e) {
    console.error('scheduler failed', job, e);
    return json({ error: (e as Error).message }, 500);
  }
});

async function autobot() {
  if (!Deno.env.get('RECALL_API_KEY')) return { skipped: 'bot not configured' };
  const admin = adminClient();
  const { data: users } = await admin.from('user_settings').select('user_id').eq('auto_notetaker', true).limit(500);
  let sent = 0;
  const failures: string[] = [];
  for (const { user_id } of (users ?? []) as { user_id: string }[]) {
    try {
      const now = new Date();
      const { events } = await fetchEvents(user_id, now, new Date(now.getTime() + 20 * 60_000));
      const { data: existing } = await admin.from('meeting_bots').select('event_key, event_start').eq('user_id', user_id).not('event_key', 'is', null).gte('event_start', now.toISOString());
      const already = new Set((existing ?? []).map((b: { event_key: string; event_start: string }) => `${b.event_key}|${new Date(b.event_start).toISOString()}`));
      const due = meetingsToJoin(events.filter((e): e is NonNullable<typeof e> => !!e), already).filter((e) => meetingPlatform(e.meetingUrl!));
      if (!due.length) continue;
      const { data: u } = await admin.auth.admin.getUserById(user_id);
      const { data: links } = await admin.from('calendar_links').select('event_key, project_id').eq('user_id', user_id);
      for (const ev of due) {
        const recordingId = crypto.randomUUID();
        const project = (links ?? []).find((l: { event_key: string }) => l.event_key === ev.key)?.project_id ?? null;
        await admin.from('recordings').insert({
          id: recordingId, user_id, title: ev.title.slice(0, 120), template: 'meeting', source: 'bot', status: 'scheduled',
          consent_method: 'bot_announced', project_id: project, calendar_event_key: ev.key,
        });
        try {
          await createBot({ userId: user_id, email: u.user?.email ?? null, recordingId, meetingUrl: ev.meetingUrl!, joinAt: ev.start, eventKey: ev.key, eventStart: new Date(ev.start).toISOString() });
          sent++;
        } catch (e) {
          await admin.from('recordings').delete().eq('id', recordingId);
          throw e;
        }
      }
    } catch (e) {
      failures.push(`${user_id}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  if (failures.length) console.warn('autobot failures', failures.slice(0, 10));
  return { sent, failed: failures.length };
}

async function digest() {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RECAP_FROM');
  if (!key || !from) return { skipped: 'email not configured' };
  const admin = adminClient();
  const { data: users } = await admin.from('user_settings').select('user_id, timezone, digest_sent_at').eq('weekly_digest', true).limit(2000);
  let sent = 0;
  for (const u of (users ?? []) as { user_id: string; timezone: string | null; digest_sent_at: string | null }[]) {
    if (!isDigestTime(new Date(), u.timezone, u.digest_sent_at)) continue;
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: recs } = await admin.from('recordings').select('id, title, created_at').eq('user_id', u.user_id).eq('status', 'ready').gte('created_at', since).order('created_at');
    const { data: tasks } = await admin
      .from('tasks')
      .select('text, owner, due_text, status, needs_review, updated_at, recording_id, recordings!tasks_recording_id_fkey(title)')
      .eq('user_id', u.user_id)
      .neq('status', 'dismissed')
      .limit(500);
    type T = { text: string; owner: string | null; due_text: string | null; status: string; needs_review: boolean; updated_at: string; recording_id: string; recordings: { title: string } | { title: string }[] | null };
    const all = (tasks ?? []) as T[];
    const title = (t: T) => (Array.isArray(t.recordings) ? t.recordings[0]?.title : t.recordings?.title) ?? '';
    const data: DigestData = {
      recordings: ((recs ?? []) as { id: string; title: string; created_at: string }[]).map((r) => ({ title: r.title, created_at: r.created_at, tasks: all.filter((t) => t.recording_id === r.id).length })),
      open: all.filter((t) => t.status === 'open' && !t.needs_review).map((t) => ({ text: t.text, owner: t.owner, due: t.due_text, recording: title(t) })),
      done: all.filter((t) => t.status === 'done' && t.updated_at >= since).length,
    };
    if (!data.recordings.length && !data.open.length) continue;
    const { data: user } = await admin.auth.admin.getUserById(u.user_id);
    if (!user.user?.email) continue;
    const e = digestEmail(data, { appName: Deno.env.get('APP_NAME') ?? 'Murmur', appUrl: Deno.env.get('APP_URL') ?? null, weekOf: since.slice(0, 10) });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [user.user.email], subject: e.subject, html: e.html, text: e.text }),
    });
    if (res.ok) {
      await admin.from('user_settings').update({ digest_sent_at: new Date().toISOString() }).eq('user_id', u.user_id);
      sent++;
    }
  }
  return { sent };
}
