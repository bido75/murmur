// "Export my data": a ZIP of everything you recorded — notes, transcripts, tasks — plus download
// links for your audio. POST → { url } (a link valid for 24 hours).
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { publicNotes } from '../_shared/share.ts';
import { EXPORT_README, folderNames, notesMarkdown, tasksCsv, transcriptText } from '../_shared/export_data.ts';
import { zip } from '../_shared/zip.ts';

const MAX = 2000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');
    const { id: userId } = await requireUser(req);
    const db = adminClient();
    const { data: recs } = await db
      .from('recordings')
      .select('id, title, created_at, duration_ms, template, status, source, project_id, consent_method')
      .eq('user_id', userId)
      .order('created_at')
      .limit(MAX);
    const list = recs ?? [];
    const ids = list.map((r) => r.id as string);
    const byChunks = async <T>(table: string, cols: string): Promise<T[]> => {
      const out: T[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from(table).select(cols).in('recording_id', ids.slice(i, i + 200));
        out.push(...((data ?? []) as T[]));
      }
      return out;
    };
    type Sum = { recording_id: string; overview: string; key_points: string[]; key_point_details?: { text: string; verified?: boolean }[] | null; decisions: { text: string; quote?: string | null; verified?: boolean }[]; open_questions: string[]; site_log: null };
    type Tr = { recording_id: string; utterances: { start_ms: number; end_ms: number; speaker: number; text: string }[]; speaker_names: Record<string, string> };
    type Tk = { recording_id: string; text: string; owner: string | null; due_text: string | null; status: string; needs_review: boolean; quote: string | null; created_at: string };
    type Seg = { recording_id: string; idx: number; storage_path: string | null };
    const [sums, trs, tasks, segs] = await Promise.all([
      byChunks<Sum>('summaries', 'recording_id, overview, key_points, key_point_details, decisions, open_questions, site_log'),
      byChunks<Tr>('transcripts', 'recording_id, utterances, speaker_names'),
      byChunks<Tk>('tasks', 'recording_id, text, owner, due_text, status, needs_review, quote, created_at'),
      byChunks<Seg>('recording_segments', 'recording_id, idx, storage_path'),
    ]);
    const names = folderNames(list as { id: string; title: string; created_at: string }[]);
    const files: { name: string; data: string }[] = [];
    const app = Deno.env.get('APP_NAME') ?? 'Murmur';
    files.push({ name: 'README.txt', data: EXPORT_README(app, new Date().toISOString().slice(0, 10)) });
    const titleOf = new Map(list.map((r) => [r.id as string, r.title as string]));
    for (const r of list) {
      const folder = `recordings/${names.get(r.id as string)}`;
      const summary = sums.find((s) => s.recording_id === r.id) ?? null;
      const transcript = trs.find((t) => t.recording_id === r.id) ?? null;
      const myTasks = tasks.filter((t) => t.recording_id === r.id);
      const n = publicNotes({ recording: r as { title: string; created_at: string; duration_ms: number; template: string }, summary, tasks: myTasks, transcript }, true);
      files.push({ name: `${folder}/notes.md`, data: notesMarkdown(n) });
      if (transcript) files.push({ name: `${folder}/transcript.txt`, data: transcriptText(n) });
      files.push({ name: `${folder}/data.json`, data: JSON.stringify({ recording: r, summary, tasks: myTasks, transcript }, null, 2) });
    }
    files.push({ name: 'tasks.csv', data: tasksCsv(tasks.map((t) => ({ ...t, recording: titleOf.get(t.recording_id) ?? '' }))) });
    const links: string[] = [];
    for (const s of segs.filter((s) => s.storage_path)) {
      const { data } = await db.storage.from('audio').createSignedUrl(s.storage_path!, 7 * 86400);
      if (data?.signedUrl) links.push(`${names.get(s.recording_id)}/part-${s.idx}: ${data.signedUrl}`);
    }
    files.push({ name: 'audio-links.txt', data: links.join('\n') + '\n' });

    const path = `${userId}/murmur-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const { error } = await db.storage.from('exports').upload(path, zip(files), { contentType: 'application/zip', upsert: true });
    if (error) throw new Error(error.message);
    const { data: signed } = await db.storage.from('exports').createSignedUrl(path, 86400, { download: true });
    await db.rpc('audit', { ws: null, act: 'data.exported', ttype: 'user', tid: userId, m: { recordings: list.length, truncated: list.length >= MAX }, who: userId });
    return json({ url: signed?.signedUrl, recordings: list.length, truncated: list.length >= MAX });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('export-data error', e);
    return json({ error: (e as Error).message }, status);
  }
});
