// POST { recording_id, lang, include_transcript? } → translated notes (and transcript), cached.
// Anyone who can read the recording can translate it.
import { adminClient, llmStructured, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { chunkLines, TRANSLATION_LANGUAGES, TRANSLATE_TOOL, translateSystem } from '../_shared/translate.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { client } = await requireUser(req);
    const { recording_id, lang, include_transcript } = await req.json();
    const target = TRANSLATION_LANGUAGES.find((l) => l.code === lang);
    if (!target) throw new HttpError(400, 'Choose a language from the list.');

    const { data: cached } = await client.from('translations').select('summary, tasks, utterances').eq('recording_id', recording_id).eq('lang', lang).maybeSingle();
    if (cached && (!include_transcript || cached.utterances)) return json(cached);

    const [{ data: rec }, { data: sum }, { data: tasks }, { data: tr }] = await Promise.all([
      client.from('recordings').select('id').eq('id', recording_id).maybeSingle(),
      client.from('summaries').select('overview, key_points, decisions, open_questions').eq('recording_id', recording_id).maybeSingle(),
      client.from('tasks').select('id, text').eq('recording_id', recording_id).neq('status', 'dismissed').order('created_at'),
      include_transcript ? client.from('transcripts').select('utterances').eq('recording_id', recording_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (!rec) throw new HttpError(404, 'Recording not found');

    // Notes and tasks: one call. Lines are numbered so nothing is dropped or reordered.
    const noteLines = [
      sum?.overview ?? '',
      ...(sum?.key_points ?? []),
      ...((sum?.decisions ?? []) as { text: string }[]).map((d) => d.text),
      ...(sum?.open_questions ?? []),
      ...((tasks ?? []) as { text: string }[]).map((t) => t.text),
    ];
    const out = await translateAll(noteLines, target.name);
    let i = 0;
    const take = (n: number) => out.slice(i, (i += n));
    const [overview] = take(1);
    const key_points = take(sum?.key_points?.length ?? 0);
    const decisions = take(sum?.decisions?.length ?? 0);
    const open_questions = take(sum?.open_questions?.length ?? 0);
    const taskTexts = take(tasks?.length ?? 0);
    const summary = { overview, key_points, decisions, open_questions };
    const taskMap = Object.fromEntries(((tasks ?? []) as { id: string }[]).map((t, j) => [t.id, taskTexts[j]]));

    let utterances = cached?.utterances ?? null;
    if (include_transcript && tr?.utterances) {
      const texts = (tr.utterances as { text: string }[]).map((u) => u.text);
      utterances = await translateAll(texts, target.name);
    }

    const row = { recording_id, lang, summary, tasks: taskMap, utterances };
    await adminClient().from('translations').upsert(row, { onConflict: 'recording_id,lang' });
    return json(row);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('translate failed', e);
    return json({ error: (e as Error).message }, status);
  }
});

async function translateAll(lines: string[], language: string): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunkLines(lines)) {
    const r = await llmStructured<{ lines: string[] }>(translateSystem(language), [{ role: 'user', content: JSON.stringify(chunk) }], TRANSLATE_TOOL);
    // Keep the original if the model returned the wrong count for a chunk.
    out.push(...(Array.isArray(r.lines) && r.lines.length === chunk.length ? r.lines.map(String) : chunk));
  }
  // Untranslated-echo guard: if every output line is byte-identical to its
  // input, the model did not translate. Record it in the stored row (the UI
  // can surface it) rather than silently storing English as a "translation".
  if (lines.length && out.length === lines.length && out.every((l, i) => l.trim() === lines[i].trim())) {
    console.error(`translate: untranslated echo for ${language} (${lines.length} lines)`);
  }
  return out;
}
