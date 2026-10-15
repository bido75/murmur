import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { APP_NAME } from './config';
import { isWeb } from './dialog';
import { clock, shortDate } from './format';
import { siteLogSections } from './siteLogText';
import { CONSENT_LABELS, type Photo, type Recording, type Summary, type Task } from './types';

export function toMarkdown(rec: Recording, summary: Summary | null, tasks: Task[]): string {
  const lines: string[] = [`# ${rec.title}`, shortDate(rec.created_at), ''];
  if (summary?.overview) lines.push(summary.overview, '');
  const log = siteLogSections(summary?.site_log);
  if (log.length) {
    lines.push('## Daily site log');
    for (const sec of log) lines.push(`**${sec.title}**`, ...sec.items.map((i) => `- ${i}`));
    lines.push('');
  }
  if (summary?.key_points?.length) lines.push('## Key points', ...summary.key_points.map((p) => `- ${p}`), '');
  if (summary?.decisions?.length) lines.push('## Decisions', ...summary.decisions.map((d) => `- ${d.text}`), '');
  const open = tasks.filter((t) => t.status !== 'dismissed');
  if (open.length) {
    lines.push('## Action items');
    for (const t of open) {
      const meta = [t.owner, t.due_text && `due ${t.due_text}`].filter(Boolean).join(', ');
      lines.push(`- [${t.status === 'done' ? 'x' : ' '}] ${t.text}${meta ? ` (${meta})` : ''}`);
    }
    lines.push('');
  }
  if (summary?.open_questions?.length) lines.push('## Open questions', ...summary.open_questions.map((q) => `- ${q}`), '');
  if (rec.consent_method) lines.push(`Recording notice: ${CONSENT_LABELS[rec.consent_method]}`);
  lines.push(`— Notes by ${APP_NAME}`);
  return lines.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toHtml(rec: Recording, summary: Summary | null, tasks: Task[], photos: Photo[] = []): string {
  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const log = siteLogSections(summary?.site_log);
  const logHtml = log.length ? `<h2>Daily site log</h2>${log.map((sec) => `<h3${sec.title === 'Safety' ? ' class="safety"' : ''}>${esc(sec.title)}</h3>${list(sec.items)}`).join('')}` : '';
  const shown = photos.filter((p) => p.url && /^https:/.test(p.url)).slice(0, 24);
  const photoHtml = shown.length
    ? `<h2>Photos</h2><div class="photos">${shown
        .map((p) => `<figure><img src="${esc(p.url!)}"/><figcaption>${esc([p.caption, p.taken_ms != null ? clock(p.taken_ms) : null].filter(Boolean).join(' · '))}</figcaption></figure>`)
        .join('')}</div>`
    : '';
  const taskRows = tasks
    .filter((t) => t.status !== 'dismissed')
    .map(
      (t) =>
        `<tr><td>${t.status === 'done' ? '☑' : '☐'}</td><td>${esc(t.text)}</td><td>${esc(t.owner ?? '')}</td><td>${esc(t.due_text ?? '')}</td><td class="q">${t.quote ? `“${esc(t.quote)}”${t.quote_ms != null ? ` ${clock(t.quote_ms)}` : ''}` : ''}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1A1C1A;padding:32px;line-height:1.5}
    h1{font-size:24px;margin:0} .date{color:#6B6F6A;margin-bottom:16px} h2{font-size:16px;margin-top:24px}
    table{border-collapse:collapse;width:100%;font-size:13px} td{border-top:1px solid #E4E1DA;padding:6px;vertical-align:top}
    .q{color:#6B6F6A;font-style:italic} footer{margin-top:32px;color:#6B6F6A;font-size:12px}
    h3{font-size:14px;margin:12px 0 0} h3.safety{color:#C2412D} .photos{display:flex;flex-wrap:wrap;gap:8px}
    figure{margin:0;width:48%;break-inside:avoid} figure img{width:100%;border-radius:4px} figcaption{font-size:11px;color:#6B6F6A}
  </style></head><body>
    <h1>${esc(rec.title)}</h1><div class="date">${esc(shortDate(rec.created_at))}</div>
    ${summary?.overview ? `<p>${esc(summary.overview)}</p>` : ''}
    ${logHtml}
    ${summary?.key_points?.length ? `<h2>Key points</h2>${list(summary.key_points)}` : ''}
    ${summary?.decisions?.length ? `<h2>Decisions</h2>${list(summary.decisions.map((d) => d.text))}` : ''}
    ${taskRows ? `<h2>Action items</h2><table>${taskRows}</table>` : ''}
    ${summary?.open_questions?.length ? `<h2>Open questions</h2>${list(summary.open_questions)}` : ''}
    ${photoHtml}
    <footer>${rec.consent_method ? `Recording notice: ${esc(CONSENT_LABELS[rec.consent_method])} · ` : ''}Notes by ${esc(APP_NAME)}</footer>
  </body></html>`;
}

export async function shareText(rec: Recording, summary: Summary | null, tasks: Task[]) {
  const md = toMarkdown(rec, summary, tasks);
  if (isWeb) {
    downloadWeb(`${safeName(rec.title)}.md`, new Blob([md], { type: 'text/markdown' }));
    return;
  }
  await Share.share({ title: rec.title, message: md });
}

export async function sharePdf(rec: Recording, summary: Summary | null, tasks: Task[], photos: Photo[] = []) {
  if (isWeb) {
    // Opens the browser's print dialog, where "Save as PDF" is available.
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups for this site to save a PDF.');
    w.document.write(toHtml(rec, summary, tasks, photos));
    w.document.close();
    w.focus();
    w.print();
    return;
  }
  const { uri } = await Print.printToFileAsync({ html: toHtml(rec, summary, tasks, photos) });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}

export function safeName(s: string): string {
  return s.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'notes';
}

export function downloadWeb(filename: string, blob: Blob | string) {
  const a = document.createElement('a');
  a.href = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  a.download = filename;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
