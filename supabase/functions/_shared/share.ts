// What a shared link or an emailed recap shows. Pure, unit-tested.
// Only confirmed material leaves the app: verified decisions, confirmed tasks, verified site-log
// entries. Internal fields (user ids, review state, consent details) are never included.
import type { SiteLog } from './field.ts';
import { formatClock, speakerLabel, type Utterance } from './verify.ts';

export type PublicNotes = {
  title: string;
  date: string; // ISO
  duration_ms: number;
  template: string;
  overview: string;
  key_points: { text: string; verified: boolean }[];
  decisions: { text: string; quote: string | null }[];
  tasks: { text: string; owner: string | null; due: string | null; done: boolean }[];
  open_questions: string[];
  site_log: { title: string; items: string[] }[];
  transcript: { at: string; speaker: string; text: string }[] | null;
};

type Src = {
  recording: { title: string; created_at: string; duration_ms: number; template: string };
  summary: {
    overview?: string;
    key_points?: string[];
    key_point_details?: { text: string; quote?: string | null; quote_ms?: number | null; verified?: boolean }[] | null;
    decisions?: { text: string; quote?: string | null; verified?: boolean }[];
    open_questions?: string[];
    site_log?: SiteLog | null;
  } | null;
  tasks: { text: string; owner: string | null; due_text: string | null; status: string; needs_review: boolean }[];
  transcript?: { utterances: Utterance[]; speaker_names: Record<string, string> } | null;
};

export function siteLogSections(log: SiteLog | null | undefined): { title: string; items: string[] }[] {
  if (!log) return [];
  const ok = <T extends { verified: boolean }>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.verified);
  const at = (loc: string | null) => (loc ? ` (${loc})` : '');
  return [
    { title: 'Weather', items: log.weather?.verified ? [log.weather.text] : [] },
    { title: 'Safety', items: ok(log.issues).filter((i) => i.category === 'safety').map((i) => `${i.text}${at(i.location)}`) },
    { title: 'Issues', items: ok(log.issues).filter((i) => i.category !== 'safety').map((i) => `${i.text}${at(i.location)}`) },
    { title: 'Work completed', items: ok(log.work_completed).map((w) => `${w.text}${at(w.location)}`) },
    { title: 'Manpower', items: ok(log.manpower).map((m) => (m.count != null ? `${m.company_or_trade}: ${m.count}` : m.company_or_trade)) },
    { title: 'Inspections', items: ok(log.inspections).map((i) => (i.result ? `${i.text}: ${i.result}` : i.text)) },
    { title: 'Deliveries', items: ok(log.deliveries).map((d) => d.text) },
    { title: 'Delays', items: ok(log.delays).map((d) => d.text) },
  ].filter((s) => s.items.length);
}

/** Key points say whether they were checked against the transcript, so shared pages can say so too. */
export function publicKeyPoints(
  points: string[],
  details: { text: string; quote?: string | null; quote_ms?: number | null; verified?: boolean }[] | null | undefined,
): { text: string; verified: boolean }[] {
  const checked = new Map<string, boolean>();
  for (const d of details ?? []) checked.set(d.text.trim().toLowerCase(), d.verified !== false);
  return (points ?? []).map((p) => ({ text: p, verified: checked.get(p.trim().toLowerCase()) === true }));
}

/** One-line form of a key point, marking the ones we could not check against the transcript. */
export function keyPointText(k: { text: string; verified: boolean }): string {
  return k.verified ? k.text : `${k.text} (not checked against the transcript)`;
}

export function publicNotes(src: Src, includeTranscript: boolean): PublicNotes {
  const s = src.summary;
  return {
    title: src.recording.title,
    date: src.recording.created_at,
    duration_ms: src.recording.duration_ms,
    template: src.recording.template,
    overview: s?.overview ?? '',
    key_points: publicKeyPoints(s?.key_points ?? [], s?.key_point_details),
    decisions: (s?.decisions ?? []).filter((d) => d.verified !== false).map((d) => ({ text: d.text, quote: d.quote ?? null })),
    tasks: src.tasks
      .filter((t) => t.status !== 'dismissed' && !t.needs_review)
      .map((t) => ({ text: t.text, owner: t.owner, due: t.due_text, done: t.status === 'done' })),
    open_questions: s?.open_questions ?? [],
    site_log: siteLogSections(s?.site_log),
    transcript:
      includeTranscript && src.transcript
        ? src.transcript.utterances.map((u) => ({ at: formatClock(u.start_ms), speaker: speakerLabel(u.speaker, src.transcript!.speaker_names ?? {}), text: u.text }))
        : null,
  };
}

/** Link state check for the public share endpoint. */
export function linkStatus(link: { revoked_at: string | null; expires_at: string | null } | null, now = Date.now()): 'ok' | 'missing' | 'revoked' | 'expired' {
  if (!link) return 'missing';
  if (link.revoked_at) return 'revoked';
  if (link.expires_at && new Date(link.expires_at).getTime() < now) return 'expired';
  return 'ok';
}

// ---------- Email recap ----------

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/** Clean, deduplicated recipients from free text (commas, spaces, new lines). At most 25. */
export function parseRecipients(input: string | string[]): { valid: string[]; invalid: string[] } {
  const parts = (Array.isArray(input) ? input : input.split(/[\s,;]+/)).map((x) => x.trim().replace(/^<|>$/g, '')).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const e = p.toLowerCase();
    if (!EMAIL.test(e) || e.length > 200) invalid.push(p);
    else if (!valid.includes(e)) valid.push(e);
  }
  return { valid: valid.slice(0, 25), invalid };
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function recapEmail(n: PublicNotes, o: { appName: string; sender: string; link: string | null; note?: string | null; dateLabel: string }) {
  const subject = `Notes: ${n.title} (${o.dateLabel})`.slice(0, 200);
  const li = (items: string[]) => `<ul style="padding-left:20px;margin:6px 0 14px">${items.map((i) => `<li style="margin:3px 0">${esc(i)}</li>`).join('')}</ul>`;
  const h = (t: string) => `<h3 style="font-size:15px;margin:18px 0 4px;color:#1A1C1A">${esc(t)}</h3>`;
  const taskLine = (t: PublicNotes['tasks'][number]) => `${t.done ? '✓ ' : ''}${t.text}${[t.owner, t.due && `due ${t.due}`].filter(Boolean).length ? ` (${[t.owner, t.due && `due ${t.due}`].filter(Boolean).join(', ')})` : ''}`;
  const kpLine = (k: PublicNotes['key_points'][number]) => keyPointText(k);

  const html = `<!doctype html><html><body style="margin:0;background:#F7F5F0">
<div style="max-width:600px;margin:0 auto;padding:24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1A1C1A;line-height:1.5">
  <p style="color:#6B6F6A;font-size:13px;margin:0 0 8px">${esc(o.sender)} shared notes from ${esc(o.dateLabel)}</p>
  <h2 style="font-size:22px;margin:0 0 12px">${esc(n.title)}</h2>
  ${o.note ? `<p style="background:#fff;border-left:3px solid #1F6F5C;padding:10px 12px;margin:0 0 14px">${esc(o.note)}</p>` : ''}
  ${n.overview ? `<p style="margin:0 0 10px">${esc(n.overview)}</p>` : ''}
  ${n.tasks.length ? h('Next steps') + li(n.tasks.map(taskLine)) : ''}
  ${n.decisions.length ? h('Decisions') + li(n.decisions.map((d) => d.text)) : ''}
  ${n.site_log.map((s) => h(s.title) + li(s.items)).join('')}
  ${n.key_points.length ? h('Key points') + li(n.key_points.map(kpLine)) : ''}
  ${n.open_questions.length ? h('Open questions') + li(n.open_questions) : ''}
  ${o.link ? `<p style="margin:22px 0"><a href="${esc(o.link)}" style="background:#1F6F5C;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">Open the full notes</a></p>` : ''}
  <p style="color:#6B6F6A;font-size:12px;margin-top:24px">AI-generated notes from a recording. Key points that could not be checked against the transcript are marked. Sent with ${esc(o.appName)} by ${esc(o.sender)}. Reply to this email to reach them.</p>
</div></body></html>`;

  const text = [
    `${o.sender} shared notes from ${o.dateLabel}`,
    '',
    n.title,
    ...(o.note ? ['', o.note] : []),
    ...(n.overview ? ['', n.overview] : []),
    ...(n.tasks.length ? ['', 'Next steps:', ...n.tasks.map((t) => `- ${taskLine(t)}`)] : []),
    ...(n.decisions.length ? ['', 'Decisions:', ...n.decisions.map((d) => `- ${d.text}`)] : []),
    ...n.site_log.flatMap((s) => ['', `${s.title}:`, ...s.items.map((i) => `- ${i}`)]),
    ...(n.key_points.length ? ['', 'Key points:', ...n.key_points.map((k) => `- ${kpLine(k)}`)] : []),
    ...(n.open_questions.length ? ['', 'Open questions:', ...n.open_questions.map((q) => `- ${q}`)] : []),
    ...(o.link ? ['', `Full notes: ${o.link}`] : []),
  ].join('\n');

  return { subject, html, text };
}
