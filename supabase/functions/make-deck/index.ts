// POST { kind, recording_id? | project_id?, audience? } → { url, filename }
// Builds a .pptx from a recording's (or a whole project's) verified notes.
import { buildPptx, DECK_KINDS, DECK_TOOL, deckSystemPrompt, sanitizeSlides, type DeckData, type DeckKind } from '../_shared/deck.ts';
import { adminClient, llmStructured, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { captionPhotos, type PhotoRow, type SiteLog } from '../_shared/field.ts';

type Rec = { id: string; title: string; created_at: string };
type Sum = { recording_id: string; site_log: SiteLog | null; overview: string; key_points: string[]; decisions: { text: string; quote: string; verified: boolean }[]; open_questions: string[] };
type TaskRow = { text: string; owner: string | null; due_text: string | null; status: string; needs_review: boolean; recording_id: string; quote: string | null; photo_ids: string[] | null };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { id: userId, client } = await requireUser(req);
    const { kind, recording_id, project_id, audience } = await req.json();
    if (!(kind in DECK_KINDS)) throw new HttpError(400, 'Unknown deck type');
    if (!recording_id && !project_id) throw new HttpError(400, 'recording_id or project_id is required');

    // Gather material as the user (RLS keeps it to their own data).
    let recs: Rec[] = [];
    let name = '';
    if (recording_id) {
      const { data } = await client.from('recordings').select('id, title, created_at').eq('id', recording_id).eq('status', 'ready');
      recs = (data ?? []) as Rec[];
      name = recs[0]?.title ?? '';
    } else {
      const { data: proj } = await client.from('projects').select('name').eq('id', project_id).maybeSingle();
      if (!proj) throw new HttpError(404, 'Project not found');
      name = proj.name;
      const { data } = await client
        .from('recordings')
        .select('id, title, created_at')
        .eq('project_id', project_id)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(10);
      recs = ((data ?? []) as Rec[]).reverse();
    }
    if (!recs.length) throw new HttpError(400, 'There are no finished notes to build a deck from yet.');

    const ids = recs.map((r) => r.id);
    const [{ data: sums }, { data: tasks }] = await Promise.all([
      client.from('summaries').select('recording_id, overview, key_points, decisions, open_questions, site_log').in('recording_id', ids),
      client.from('tasks').select('text, owner, due_text, status, needs_review, recording_id, quote, photo_ids').in('recording_id', ids).neq('status', 'dismissed').eq('needs_review', false).order('created_at'),
    ]);

    const material = recs
      .map((r) => {
        const s = (sums as Sum[] | null)?.find((x) => x.recording_id === r.id);
        if (!s) return '';
        return [
          `## ${r.title} (${r.created_at.slice(0, 10)})`,
          s.overview,
          ...s.key_points.map((k) => `- ${k}`),
          ...s.decisions.filter((d) => d.verified).map((d) => `Decision: ${d.text}`),
          ...s.open_questions.map((q) => `Open question: ${q}`),
        ].join('\n');
      })
      .join('\n\n');
    const taskList = ((tasks ?? []) as TaskRow[]).map((t) => `- [${t.status}] ${t.text}${t.owner ? ` (${t.owner})` : ''}`).join('\n');

    const k = kind as DeckKind;
    const written = await llmStructured<{ title: string; subtitle: string; slides: unknown }>(
      deckSystemPrompt(k, audience ? String(audience).slice(0, 300) : null),
      [{ role: 'user', content: `Material:\n\n${material}\n\nTasks (already shown on their own slide):\n${taskList || 'none'}` }],
      DECK_TOOL,
    );

    const dateRange = recs.length > 1
      ? `${recs[0].created_at.slice(0, 10)} – ${recs[recs.length - 1].created_at.slice(0, 10)}`
      : recs[0].created_at.slice(0, 10);
    const deck: DeckData = {
      title: (written.title || name).slice(0, 90),
      subtitle: written.subtitle || `${DECK_KINDS[k].label} · ${dateRange}`,
      footer: `${name} · ${DECK_KINDS[k].label} · ${dateRange}`,
      slides: sanitizeSlides(written.slides),
      decisions: ((sums ?? []) as Sum[]).flatMap((s) => s.decisions.filter((d) => d.verified).map((d) => ({ text: d.text, quote: d.quote }))),
      tasks: ((tasks ?? []) as TaskRow[]).map((t) => ({ text: t.text, owner: t.owner, due: t.due_text, status: t.status === 'done' ? 'done' : 'open' })),
      questions: ((sums ?? []) as Sum[]).flatMap((s) => s.open_questions),
    };

    if (k === 'site_report') {
      const logs = ((sums ?? []) as Sum[]).map((x) => ({ recording_id: x.recording_id, site_log: x.site_log }));
      deck.safety = logs.flatMap((l) => (l.site_log?.issues ?? []).filter((i) => i.verified && i.category === 'safety').map((i) => ({ text: i.text, location: i.location })));
      deck.photos = await deckPhotos(client, ids, logs, (tasks ?? []) as TaskRow[], Object.fromEntries(recs.map((r) => [r.id, r.title])));
    }

    const bytes = await buildPptx(deck);
    const safe = deck.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'deck';
    const filename = `${safe}.pptx`;
    const path = `${userId}/${crypto.randomUUID()}/${filename}`;
    const admin = adminClient();
    const { error: upErr } = await admin.storage.from('exports').upload(path, bytes, {
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await admin.storage.from('exports').createSignedUrl(path, 60 * 60, { download: filename });
    return json({ url: signed?.signedUrl, filename, slides: deck.slides.length + 1 });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

/** Photos for a site report: chosen and captioned from the notes, read through RLS, downloaded server-side. */
// deno-lint-ignore no-explicit-any
async function deckPhotos(client: any, ids: string[], logs: { recording_id: string; site_log: SiteLog | null }[], tasks: TaskRow[], titles: Record<string, string>) {
  const { data } = await client
    .from('recording_photos')
    .select('id, recording_id, taken_ms, caption, width, height, storage_path')
    .in('recording_id', ids)
    .limit(200);
  const chosen = captionPhotos((data ?? []) as PhotoRow[], logs, tasks, titles, 10);
  const admin = adminClient();
  const out = [];
  for (const p of chosen) {
    const { data: blob } = await admin.storage.from('photos').download(p.storage_path);
    if (!blob) continue;
    out.push({
      dataUri: `data:image/jpeg;base64,${encodeBase64(new Uint8Array(await blob.arrayBuffer()))}`,
      width: p.width,
      height: p.height,
      caption: p.title,
      detail: p.detail,
      quote: p.quote,
    });
  }
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
