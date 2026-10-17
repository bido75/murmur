// "Export my data": readable files for each recording. Pure; tested.
import type { PublicNotes } from './share.ts';

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recording';
}

/** Unique folder names: 2026-10-15-oac-12, 2026-10-15-oac-12-2, … */
export function folderNames(recs: { id: string; title: string; created_at: string }[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const r of recs) {
    const base = `${r.created_at.slice(0, 10)}-${slug(r.title)}`;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    out.set(r.id, name);
  }
  return out;
}

export function notesMarkdown(n: PublicNotes): string {
  const lines = [`# ${n.title}`, '', `${n.date.slice(0, 16).replace('T', ' ')} UTC · ${Math.round(n.duration_ms / 60000)} min · ${n.template.replace('_', ' ')}`, ''];
  if (n.overview) lines.push('## Summary', '', n.overview, '');
  if (n.key_points.length) lines.push('## Key points', '', ...n.key_points.map((k) => `- ${k}`), '');
  if (n.decisions.length) lines.push('## Decisions', '', ...n.decisions.map((d) => `- ${d.text}${d.quote ? ` — “${d.quote}”` : ''}`), '');
  if (n.tasks.length) lines.push('## Tasks', '', ...n.tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}${t.owner ? ` (${t.owner})` : ''}${t.due ? ` — due ${t.due}` : ''}`), '');
  if (n.open_questions.length) lines.push('## Open questions', '', ...n.open_questions.map((q) => `- ${q}`), '');
  for (const s of n.site_log) lines.push(`## ${s.title}`, '', ...s.items.map((i) => `- ${i}`), '');
  return lines.join('\n');
}

export function transcriptText(n: PublicNotes): string {
  return (n.transcript ?? []).map((u) => `[${u.at}] ${u.speaker}: ${u.text}`).join('\n') + '\n';
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Quote, and defuse spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function tasksCsv(rows: { text: string; owner: string | null; due_text: string | null; status: string; recording: string; created_at: string; quote: string | null }[]): string {
  const head = ['task', 'owner', 'due', 'status', 'recording', 'created', 'quote'];
  return [head.join(','), ...rows.map((r) => [r.text, r.owner, r.due_text, r.status, r.recording, r.created_at, r.quote].map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export const EXPORT_README = (app: string, when: string) => `${app} data export — ${when}

recordings/<date>-<title>/
  notes.md        summary, decisions, tasks and site log
  transcript.txt  the full transcript with speakers and times
  data.json       everything above in machine-readable form
tasks.csv         every task from your recordings
audio-links.txt   download links for your audio (valid for 7 days)

Recordings in team projects that teammates made are not included; ask them or a team admin.
`;
