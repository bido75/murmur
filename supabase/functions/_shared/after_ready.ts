// What happens after a recording's notes are ready: webhooks, the owner's automations and
// topic alerts. Every step is independent; a failure is logged on that webhook or automation
// and never fails the recording.
import { adminClient } from './services.ts';
import { matchingAutomations, recordingEvent, signWebhook, topicHits, type Action, type RecordingEvent } from './connect.ts';
import { exportGoogleDoc, exportNotion, exportOneNote, logHubspot, logSalesforce, postSlack } from './destinations.ts';
import { buildDocx } from './docx.ts';
import { loadNotes, recordingLink, type RecordingRow } from './notes_data.ts';
import { notifyUser } from './push.ts';
import { createIssue, describeTask, type Config, type Provider } from './trackers.ts';
import { recapEmail, type PublicNotes } from './share.ts';

export type Destination = 'slack' | 'notion' | 'google_docs' | 'onenote' | 'hubspot' | 'salesforce';

export async function sendTo(userId: string, d: Destination, loaded: { rec: RecordingRow; notes: PublicNotes }, link: string | null, emails: string[] = []) {
  const n = loaded.notes;
  switch (d) {
    case 'slack': return postSlack(userId, n, link);
    case 'notion': return exportNotion(userId, n, link);
    case 'onenote': return exportOneNote(userId, n, link);
    case 'hubspot': return logHubspot(userId, n, link, emails);
    case 'salesforce': return logSalesforce(userId, n, link, emails);
    case 'google_docs': {
      const bytes = await buildDocx(n, { appName: Deno.env.get('APP_NAME') ?? 'Murmur', dateLabel: n.date.slice(0, 10) });
      return exportGoogleDoc(userId, `${n.title} (${n.date.slice(0, 10)})`, bytes);
    }
  }
}

async function deliver(url: string, secret: string, event: RecordingEvent): Promise<{ status: number; error: string | null }> {
  const body = JSON.stringify(event);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Murmur-Webhooks/1', 'X-Murmur-Event': event.type, 'X-Murmur-Signature': await signWebhook(secret, body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, error: res.ok ? null : (await res.text()).slice(0, 200) };
  } catch (e) {
    return { status: 0, error: (e as Error).message.slice(0, 200) };
  }
}

export async function runAfterReady(recordingId: string) {
  const admin = adminClient();
  const loaded = await loadNotes(admin, recordingId);
  if (!loaded) return;
  const { rec, notes } = loaded;
  const link = recordingLink(recordingId);
  const recInfo = { id: rec.id, title: rec.title, created_at: rec.created_at, duration_ms: rec.duration_ms, template: rec.template, project_id: rec.project_id, url: link };

  // 1. Webhooks (yours, for all recordings or this project).
  const { data: hooks } = await admin.from('webhooks').select('id, url, secret, events, project_id').eq('user_id', rec.user_id).eq('active', true);
  for (const h of (hooks ?? []) as { id: string; url: string; secret: string; events: string[]; project_id: string | null }[]) {
    if (!h.events.includes('recording.ready') || (h.project_id && h.project_id !== rec.project_id)) continue;
    const r = await deliver(h.url, h.secret, recordingEvent('recording.ready', recInfo, { notes }));
    await admin.from('webhooks').update({ last_status: r.status, last_error: r.error, last_delivery_at: new Date().toISOString() }).eq('id', h.id);
  }

  // 2. Automations.
  const { data: autos } = await admin.from('automations').select('id, name, project_id, template, actions, active').eq('user_id', rec.user_id);
  for (const a of matchingAutomations(autos ?? [], rec)) {
    const results: string[] = [];
    for (const action of a.actions) {
      try {
        results.push(await runAction(rec, notes, link, action));
      } catch (e) {
        results.push(`${action.type}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    await admin.from('automations').update({ last_run_at: new Date().toISOString(), last_result: results.join(' · ').slice(0, 1000) }).eq('id', a.id);
  }

  // 3. Topic alerts.
  const { data: alerts } = await admin.from('topic_alerts').select('id, phrase, project_id, email').eq('user_id', rec.user_id);
  if (alerts?.length) {
    const { data: tr } = await admin.from('transcripts').select('utterances').eq('recording_id', recordingId).maybeSingle();
    const hits = topicHits(alerts, rec.project_id, (tr?.utterances ?? []) as { start_ms: number; text: string }[]);
    for (const hit of hits) {
      await notifyUser(rec.user_id, { title: `“${hit.phrase}” came up`, body: `${rec.title}: “${hit.quote}”`, data: { recording_id: recordingId, t: String(hit.at_ms) } });
    }
    const emailHits = hits.filter((h) => alerts.find((a) => a.id === h.id)?.email);
    if (emailHits.length) await emailAlert(rec, emailHits, link).catch((e) => console.warn('alert email failed', (e as Error).message));
  }
}

export async function runFailedHooks(recordingId: string, error: string) {
  const admin = adminClient();
  const { data: rec } = await admin.from('recordings').select('id, user_id, title, created_at, duration_ms, template, project_id').eq('id', recordingId).maybeSingle();
  if (!rec) return;
  const { data: hooks } = await admin.from('webhooks').select('id, url, secret, events, project_id').eq('user_id', rec.user_id).eq('active', true);
  for (const h of (hooks ?? []) as { id: string; url: string; secret: string; events: string[]; project_id: string | null }[]) {
    if (!h.events.includes('recording.failed') || (h.project_id && h.project_id !== rec.project_id)) continue;
    const r = await deliver(h.url, h.secret, recordingEvent('recording.failed', { ...rec, url: recordingLink(rec.id) }, { error }));
    await admin.from('webhooks').update({ last_status: r.status, last_error: r.error, last_delivery_at: new Date().toISOString() }).eq('id', h.id);
  }
}

async function runAction(rec: RecordingRow, notes: PublicNotes, link: string | null, action: Action): Promise<string> {
  const admin = adminClient();
  if (action.type === 'slack') {
    await postSlack(rec.user_id, notes, link);
    return 'slack: posted';
  }
  if (action.type === 'export') {
    await sendTo(rec.user_id, action.destination, { rec, notes }, link);
    return `${action.destination}: sent`;
  }
  if (action.type === 'email') {
    const key = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('RECAP_FROM');
    if (!key || !from) throw new Error('email is not set up');
    const { data: u } = await admin.auth.admin.getUserById(rec.user_id);
    const sender = u.user?.email ?? 'A colleague';
    const e = recapEmail(notes, { appName: Deno.env.get('APP_NAME') ?? 'Murmur', sender, link, dateLabel: rec.created_at.slice(0, 10) });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [sender], bcc: action.to, reply_to: u.user?.email, subject: e.subject, html: e.html, text: e.text }),
    });
    if (!res.ok) throw new Error(`email ${res.status}`);
    await admin.from('recap_emails').insert({ recording_id: rec.id, sent_by: rec.user_id, recipients: action.to });
    return `email: sent to ${action.to.length}`;
  }
  if (action.type === 'webhook') {
    const r = await deliver(action.url, 'automation', recordingEvent('recording.ready', { ...rec, url: link }, { notes }));
    return `webhook: ${r.status || r.error}`;
  }
  // tracker: send confirmed tasks that haven't been sent there yet
  const { data: integ } = await admin.from('integrations').select('secret, config').eq('user_id', rec.user_id).eq('provider', action.provider).maybeSingle();
  if (!integ) throw new Error('not connected');
  if (['procore', 'salesforce'].includes(action.provider)) throw new Error('send these from the Tasks tab');
  const { data: tasks } = await admin.from('tasks').select('id, text, owner, due_text, due_date, quote, quote_ms, external, status, needs_review').eq('recording_id', rec.id);
  let sent = 0;
  for (const t of (tasks ?? []) as { id: string; text: string; owner: string | null; due_text: string | null; due_date: string | null; quote: string | null; quote_ms: number | null; external: Record<string, unknown> | null; status: string; needs_review: boolean }[]) {
    if (t.status !== 'open' || t.needs_review || (t.external ?? {})[action.provider]) continue;
    const created = await createIssue(action.provider as Provider, integ.secret, integ.config as Config, { title: t.text, description: describeTask(t, rec, link), dueDate: t.due_date });
    await admin.from('tasks').update({ external: { ...(t.external ?? {}), [action.provider]: { id: created.id, key: created.key ?? null, url: created.url } } }).eq('id', t.id);
    sent++;
  }
  return `${action.provider}: ${sent} task${sent === 1 ? '' : 's'}`;
}

async function emailAlert(rec: RecordingRow, hits: { phrase: string; quote: string }[], link: string | null) {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RECAP_FROM');
  if (!key || !from) return;
  const { data: u } = await adminClient().auth.admin.getUserById(rec.user_id);
  if (!u.user?.email) return;
  const text = [`In "${rec.title}":`, ...hits.map((h) => `- "${h.phrase}": "${h.quote}"`), ...(link ? ['', link] : [])].join('\n');
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [u.user.email], subject: `Topic alert: ${hits.map((h) => h.phrase).join(', ')}`.slice(0, 200), text }),
  });
}
