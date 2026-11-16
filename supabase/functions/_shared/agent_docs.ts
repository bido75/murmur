// Deno-side document/presentation generation for the agent's Phase 5 tools. Reuses the
// existing deck (PPTX) and docx renderers. Lives outside the pure, node-tested registry
// because it pulls in pptxgenjs/docx; the endpoint injects these as `actions`.
//
// NOTE: this module is typecheck-deferred in this environment — `npm:pptxgenjs@3` and
// `npm:docx@9` are not in the local Deno cache (the same limitation that already affects
// the unchanged `make-deck` and `export` functions). It is a faithful reuse of those
// paths; run `deno check` against a populated cache/CI before relying on it.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { clientUrl, llmStructured } from './services.ts';
import { buildPptx, DECK_KINDS, DECK_TOOL, deckSystemPrompt, resolveTheme, sanitizeSlides, type DeckData, type DeckEnhancements, type DeckKind } from './deck.ts';
import { inspectPptx } from './pptx_verify.ts';
import { buildDocx } from './docx.ts';
import { loadNotes } from './notes_data.ts';

type Rec = { id: string; title: string; created_at: string };
type Sum = { recording_id: string; overview: string; key_points: string[]; detailed_sections: { heading: string; paragraphs: string[] }[] | null; conclusions: string[] | null; decisions: { text: string; quote: string; verified: boolean }[]; open_questions: string[] };
type TaskRow = { text: string; owner: string | null; due_text: string | null; status: string; needs_review: boolean; recording_id: string };

export type PresentationArgs = {
  recording_id?: string;
  project_id?: string;
  kind: string;
  audience?: string;
  detail?: 'concise' | 'detailed';
};

export async function generatePresentation(client: SupabaseClient, admin: SupabaseClient, userId: string, args: PresentationArgs): Promise<{ url: string | null; filename: string; slides: number; embeddedMedia: number }> {
  if (!(args.kind in DECK_KINDS)) throw new Error('Unknown deck type');
  if (!args.recording_id && !args.project_id) throw new Error('recording_id or project_id is required');
  const theme = resolveTheme(undefined);
  // Image generation stays off for the agent (billable, not wired); the other
  // non-billable enhancements (diagrams/charts/notes) keep the make-deck defaults.
  const enh: DeckEnhancements = { images: false, diagrams: true, charts: true, notes: true };

  let recs: Rec[] = [];
  let name = '';
  if (args.recording_id) {
    const { data } = await client.from('recordings').select('id, title, created_at').eq('id', args.recording_id).eq('status', 'ready');
    recs = (data ?? []) as Rec[];
    name = recs[0]?.title ?? '';
  } else {
    const { data: proj } = await client.from('projects').select('name').eq('id', args.project_id).maybeSingle();
    if (!proj) throw new Error('Project not found');
    name = proj.name;
    const { data } = await client.from('recordings').select('id, title, created_at').eq('project_id', args.project_id).eq('status', 'ready').order('created_at', { ascending: false }).limit(10);
    recs = ((data ?? []) as Rec[]).reverse();
  }
  if (!recs.length) throw new Error('There are no finished notes to build a deck from yet');

  const ids = recs.map((r) => r.id);
  const [{ data: sums }, { data: tasks }] = await Promise.all([
    client.from('summaries').select('recording_id, overview, key_points, detailed_sections, conclusions, decisions, open_questions').in('recording_id', ids),
    client.from('tasks').select('text, owner, due_text, status, needs_review, recording_id').in('recording_id', ids).neq('status', 'dismissed').eq('needs_review', false).order('created_at'),
  ]);

  const material = recs.map((r) => {
    const s = (sums as Sum[] | null)?.find((x) => x.recording_id === r.id);
    if (!s) return '';
    const detailed = (s.detailed_sections ?? []).map((sec) => `### ${sec.heading}\n${(sec.paragraphs ?? []).join('\n')}`).join('\n\n');
    return [
      `## ${r.title} (${r.created_at.slice(0, 10)})`,
      s.overview,
      ...s.key_points.map((k) => `- ${k}`),
      ...s.decisions.filter((d) => d.verified).map((d) => `Decision: ${d.text}`),
      ...s.open_questions.map((q) => `Open question: ${q}`),
      ...(s.conclusions?.length ? [`Conclusions: ${s.conclusions.join('; ')}`] : []),
      detailed,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  const taskList = ((tasks ?? []) as TaskRow[]).map((t) => `- [${t.status}] ${t.text}${t.owner ? ` (${t.owner})` : ''}`).join('\n');

  const k = args.kind as DeckKind;
  const depth = args.detail === 'concise' ? 'Keep it tight: 3 to 5 slides.' : args.detail === 'detailed' ? 'Be thorough: up to 9 slides.' : 'Aim for 4 to 7 slides.';
  const written = await llmStructured<{ title: string; subtitle: string; slides: unknown }>(
    deckSystemPrompt(k, args.audience ? String(args.audience).slice(0, 300) : null, enh) + `\n${depth}`,
    [{ role: 'user', content: `Material:\n\n${material}\n\nTasks (already shown on their own slide):\n${taskList || 'none'}` }],
    DECK_TOOL,
  );

  const deck: DeckData = {
    title: (written.title || name).slice(0, 90),
    subtitle: written.subtitle || `${DECK_KINDS[k].label} · ${recs[0].created_at.slice(0, 10)}`,
    footer: `${name} · ${DECK_KINDS[k].label} · ${recs[0].created_at.slice(0, 10)}`,
    slides: sanitizeSlides(written.slides),
    decisions: ((sums ?? []) as Sum[]).flatMap((s) => s.decisions.filter((d) => d.verified).map((d) => ({ text: d.text, quote: d.quote }))),
    tasks: ((tasks ?? []) as TaskRow[]).map((t) => ({ text: t.text, owner: t.owner, due: t.due_text, status: t.status === 'done' ? 'done' : 'open' })),
    questions: ((sums ?? []) as Sum[]).flatMap((s) => s.open_questions),
  };

  const bytes = await buildPptx(deck, { theme });
  const inspection = inspectPptx(bytes);
  const safe = deck.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'deck';
  const filename = `${safe}.pptx`;
  const path = `${userId}/${crypto.randomUUID()}/${filename}`;
  const { error: upErr } = await admin.storage.from('exports').upload(path, bytes, {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);
  const { data: signed } = await admin.storage.from('exports').createSignedUrl(path, 60 * 60, { download: filename });
  return { url: clientUrl(signed?.signedUrl) ?? null, filename, slides: deck.slides.length + 1, embeddedMedia: inspection.media.length };
}

export async function generateDocument(admin: SupabaseClient, userId: string, recordingId: string): Promise<{ url: string | null; filename: string }> {
  const { data: r } = await admin.from('recordings').select('user_id').eq('id', recordingId).maybeSingle();
  if (!r) throw new Error('Recording not found');
  if (r.user_id !== userId) throw new Error('Only the recording owner can generate a document');
  const loaded = await loadNotes(admin, recordingId);
  if (!loaded) throw new Error('No notes to generate a document from');
  const bytes = await buildDocx(loaded.notes, { appName: Deno.env.get('APP_NAME') ?? 'Murmur', dateLabel: loaded.rec.created_at.slice(0, 10) });
  const filename = `${loaded.rec.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'notes'}.docx`;
  const path = `${userId}/${crypto.randomUUID()}/${filename}`;
  const { error: upErr } = await admin.storage.from('exports').upload(path, bytes, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { data: signed } = await admin.storage.from('exports').createSignedUrl(path, 60 * 60, { download: filename });
  return { url: clientUrl(signed?.signedUrl) ?? null, filename };
}
