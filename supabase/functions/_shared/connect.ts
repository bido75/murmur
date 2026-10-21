// Pure builders for webhooks, destinations, automations, alerts and the weekly digest.
// Everything here is unit-tested; the fetch calls live in destinations_live.ts.
import type { PublicNotes } from './share.ts';
import { keyPointText } from './share.ts';

// ---------- Webhooks ----------

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">` (same idea as Stripe). */
export async function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${hex(sig)}`;
}

/** For receivers (and our tests): check a signature within 5 minutes. */
export async function verifyWebhookSignature(secret: string, body: string, header: string, now = Date.now()): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300 || !parts.v1) return false;
  const expected = (await signWebhook(secret, body, t)).split('v1=')[1];
  if (expected.length !== parts.v1.length) return false;
  let d = 0;
  for (let i = 0; i < expected.length; i++) d |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return d === 0;
}

export type RecordingEvent = {
  id: string;
  type: 'recording.ready' | 'recording.failed';
  created_at: string;
  data: {
    recording: { id: string; title: string; created_at: string; duration_ms: number; template: string; project_id: string | null; url: string | null };
    notes?: PublicNotes;
    error?: string;
  };
};

export function recordingEvent(type: RecordingEvent['type'], rec: RecordingEvent['data']['recording'], extra: { notes?: PublicNotes; error?: string }): RecordingEvent {
  return { id: `evt_${crypto.randomUUID().replace(/-/g, '')}`, type, created_at: new Date().toISOString(), data: { recording: rec, ...extra } };
}

// ---------- Slack ----------

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function slackMessage(n: PublicNotes, link: string | null) {
  const open = n.tasks.filter((t) => !t.done);
  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: { type: 'plain_text', text: trim(n.title, 150) } },
    ...(n.overview ? [{ type: 'section', text: { type: 'mrkdwn', text: trim(n.overview, 2900) } }] : []),
  ];
  if (open.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: trim(`*Next steps*\n${open.map((t) => `• ${t.text}${t.owner ? ` — ${t.owner}` : ''}${t.due ? ` (due ${t.due})` : ''}`).join('\n')}`, 2900) },
    });
  }
  if (n.decisions.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: trim(`*Decisions*\n${n.decisions.map((d) => `• ${d.text}`).join('\n')}`, 2900) } });
  const safety = n.site_log.find((s) => s.title === 'Safety');
  if (safety) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: trim(`*:warning: Safety*\n${safety.items.map((x) => `• ${x}`).join('\n')}`, 2900) } });
  if (link) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open notes' }, url: link }] });
  return { text: `Notes: ${n.title}`, blocks: blocks.slice(0, 50) };
}

// ---------- Notion ----------

const rt = (content: string) => [{ type: 'text', text: { content: content.slice(0, 2000) } }];

export function notionBlocks(n: PublicNotes, link: string | null) {
  const b: Record<string, unknown>[] = [];
  const h = (text: string) => b.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(text) } });
  const p = (text: string) => b.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(text) } });
  const li = (text: string) => b.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(text) } });
  const todo = (text: string, done: boolean) => b.push({ object: 'block', type: 'to_do', to_do: { rich_text: rt(text), checked: done } });
  if (n.overview) p(n.overview);
  if (n.tasks.length) {
    h('Action items');
    n.tasks.forEach((t) => todo(`${t.text}${t.owner ? ` — ${t.owner}` : ''}${t.due ? ` (due ${t.due})` : ''}`, t.done));
  }
  if (n.decisions.length) {
    h('Decisions');
    n.decisions.forEach((d) => li(d.text));
  }
  for (const s of n.site_log) {
    h(s.title);
    s.items.forEach(li);
  }
  if (n.key_points.length) {
    h('Key points');
    n.key_points.forEach((k) => li(keyPointText(k)));
  }
  if (n.open_questions.length) {
    h('Open questions');
    n.open_questions.forEach(li);
  }
  if (link) p(`Full notes and recording: ${link}`);
  return b.slice(0, 100); // Notion accepts up to 100 children per request
}

// ---------- OneNote (HTML page) ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function oneNoteHtml(n: PublicNotes, link: string | null): string {
  const list = (xs: string[]) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `<!DOCTYPE html><html><head><title>${esc(n.title)}</title><meta name="created" content="${esc(n.date)}" /></head><body>
${n.overview ? `<p>${esc(n.overview)}</p>` : ''}
${n.tasks.length ? `<h2>Action items</h2>${n.tasks.map((t) => `<p data-tag="to-do${t.done ? ':completed' : ''}">${esc(t.text)}${t.owner ? ` — ${esc(t.owner)}` : ''}${t.due ? ` (due ${esc(t.due)})` : ''}</p>`).join('')}` : ''}
${n.decisions.length ? `<h2>Decisions</h2>${list(n.decisions.map((d) => d.text))}` : ''}
${n.site_log.map((s) => `<h2>${esc(s.title)}</h2>${list(s.items)}`).join('')}
${n.key_points.length ? `<h2>Key points</h2>${list(n.key_points.map(keyPointText))}` : ''}
${n.open_questions.length ? `<h2>Open questions</h2>${list(n.open_questions)}` : ''}
${link ? `<p><a href="${esc(link)}">Full notes and recording</a></p>` : ''}
</body></html>`;
}

// ---------- CRM ----------

/** Plain-text meeting note for a CRM record. */
export function crmNoteText(n: PublicNotes, link: string | null): string {
  const lines = [`${n.title} (${n.date.slice(0, 10)})`];
  if (n.overview) lines.push('', n.overview);
  if (n.decisions.length) lines.push('', 'Decisions:', ...n.decisions.map((d) => `- ${d.text}`));
  const open = n.tasks.filter((t) => !t.done);
  if (open.length) lines.push('', 'Next steps:', ...open.map((t) => `- ${t.text}${t.owner ? ` (${t.owner})` : ''}${t.due ? ` due ${t.due}` : ''}`));
  if (link) lines.push('', link);
  return lines.join('\n');
}

// ---------- Automations ----------

export type Action =
  | { type: 'slack' }
  | { type: 'email'; to: string[] }
  | { type: 'tracker'; provider: string }
  | { type: 'export'; destination: 'notion' | 'google_docs' | 'onenote' | 'hubspot' | 'salesforce' }
  | { type: 'webhook'; url: string };

export type Automation = { id: string; name: string; project_id: string | null; template: string | null; actions: unknown; active: boolean };

/** Which automations run for this recording, with their actions cleaned. */
export function matchingAutomations(list: Automation[], rec: { project_id: string | null; template: string }): (Automation & { actions: Action[] })[] {
  return list
    .filter((a) => a.active && (!a.project_id || a.project_id === rec.project_id) && (!a.template || a.template === rec.template))
    .map((a) => ({ ...a, actions: cleanActions(a.actions) }))
    .filter((a) => a.actions.length);
}

export function cleanActions(raw: unknown): Action[] {
  const out: Action[] = [];
  for (const x of Array.isArray(raw) ? raw.slice(0, 10) : []) {
    const a = x as Record<string, unknown>;
    if (a?.type === 'slack') out.push({ type: 'slack' });
    else if (a?.type === 'email' && Array.isArray(a.to)) {
      const to = (a.to as unknown[]).map(String).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 25);
      if (to.length) out.push({ type: 'email', to });
    } else if (a?.type === 'tracker' && typeof a.provider === 'string') out.push({ type: 'tracker', provider: a.provider });
    else if (a?.type === 'export' && ['notion', 'google_docs', 'onenote', 'hubspot', 'salesforce'].includes(a.destination as string)) {
      out.push({ type: 'export', destination: a.destination as 'notion' });
    } else if (a?.type === 'webhook' && typeof a.url === 'string' && /^https:\/\//.test(a.url)) out.push({ type: 'webhook', url: a.url });
  }
  return out;
}

// ---------- Topic alerts ----------

/** Alerts whose phrase was said, with the first moment it came up. Whole words, any case. */
export function topicHits(alerts: { id: string; phrase: string; project_id: string | null }[], projectId: string | null, utterances: { start_ms: number; text: string }[]) {
  const norm = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const lines = utterances.map((u) => ({ at: u.start_ms, text: norm(u.text), raw: u.text }));
  const out: { id: string; phrase: string; at_ms: number; quote: string }[] = [];
  for (const a of alerts) {
    if (a.project_id && a.project_id !== projectId) continue;
    const p = norm(a.phrase);
    if (p.trim().length < 2) continue;
    const hit = lines.find((l) => l.text.includes(p));
    if (hit) out.push({ id: a.id, phrase: a.phrase.trim(), at_ms: hit.at, quote: hit.raw.slice(0, 200) });
  }
  return out;
}

// ---------- Weekly digest ----------

export type DigestData = {
  recordings: { title: string; created_at: string; tasks: number }[];
  open: { text: string; owner: string | null; due: string | null; recording: string }[];
  done: number;
};

export function digestEmail(d: DigestData, o: { appName: string; appUrl: string | null; weekOf: string }) {
  const subject = `Your week: ${d.recordings.length} recording${d.recordings.length === 1 ? '' : 's'}, ${d.open.length} open task${d.open.length === 1 ? '' : 's'}`;
  const li = (xs: string[]) => `<ul style="padding-left:20px">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1A1C1A;max-width:600px;margin:0 auto;padding:24px;line-height:1.5">
<h2 style="margin:0 0 4px">Week of ${esc(o.weekOf)}</h2>
<p style="color:#6B6F6A;margin:0 0 16px">${d.recordings.length} recordings · ${d.done} tasks done · ${d.open.length} still open</p>
${d.open.length ? `<h3>Still open</h3>${li(d.open.slice(0, 20).map((t) => `${t.text}${t.owner ? ` — ${t.owner}` : ''}${t.due ? ` (due ${t.due})` : ''} · ${t.recording}`))}` : ''}
${d.recordings.length ? `<h3>Recorded</h3>${li(d.recordings.slice(0, 20).map((r) => `${r.title} (${r.created_at.slice(0, 10)})${r.tasks ? ` · ${r.tasks} tasks` : ''}`))}` : ''}
${o.appUrl ? `<p><a href="${esc(o.appUrl)}" style="color:#1F6F5C">Open ${esc(o.appName)}</a></p>` : ''}
<p style="color:#6B6F6A;font-size:12px">You get this because the weekly digest is on in ${esc(o.appName)} settings.</p>
</body></html>`;
  const text = [
    `Week of ${o.weekOf}: ${d.recordings.length} recordings, ${d.done} tasks done, ${d.open.length} open.`,
    ...(d.open.length ? ['', 'Still open:', ...d.open.slice(0, 20).map((t) => `- ${t.text}${t.owner ? ` (${t.owner})` : ''}`)] : []),
  ].join('\n');
  return { subject, html, text };
}

// ---------- Automatic notetaker ----------

/** Meetings to send a notetaker to now: has a link, starts within the window, not already handled. */
export function meetingsToJoin(
  events: { key: string; start: string; meetingUrl: string | null; title: string; allDay?: boolean }[],
  already: Set<string>,
  now = Date.now(),
  windowMs = 15 * 60_000,
) {
  return events.filter((e) => {
    if (!e.meetingUrl || e.allDay) return false;
    const t = new Date(e.start).getTime();
    return t > now && t - now <= windowMs && !already.has(`${e.key}|${new Date(e.start).toISOString()}`);
  });
}
