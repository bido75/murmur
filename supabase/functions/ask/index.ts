// POST { question, recording_id? } → { answer, sources }
// With recording_id: answers from that recording. Without: searches all of the user's recordings.
import { claudeText, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { ASK_SYSTEM } from '../_shared/prompts.ts';
import { formatClock, formatTranscript, normalize, speakerLabel, type Utterance } from '../_shared/verify.ts';

const MAX_CONTEXT_CHARS = 150_000;
const STOP = new Set(
  'what when where who whom why how did does do was were is are the a an and or of to in on for with about from by it its that this these those me my we our you your they them their i any anything something tell said say says during meeting call recording'.split(' '),
);

type Rec = { id: string; title: string; created_at: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { client } = await requireUser(req);
    const { question, recording_id } = await req.json();
    if (!question?.trim()) throw new HttpError(400, 'question is required');

    let context = '';
    let sources: Rec[] = [];

    if (recording_id) {
      const { data: rec } = await client.from('recordings').select('id, title, created_at').eq('id', recording_id).single();
      if (!rec) throw new HttpError(404, 'Recording not found');
      const { data: tr } = await client.from('transcripts').select('utterances, speaker_names').eq('recording_id', recording_id).single();
      const lines = formatTranscript((tr?.utterances ?? []) as Utterance[], tr?.speaker_names ?? {});
      context = `## ${rec.title} (${rec.created_at.slice(0, 10)})\n${lines}`.slice(0, MAX_CONTEXT_CHARS);
      sources = [rec];
    } else {
      const words = normalize(question).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
      let ids: string[] = [];
      if (words.length) {
        const { data: hits } = await client.rpc('search_transcripts', { q: words.join(' or '), max_results: 8 });
        ids = (hits ?? []).map((h: { recording_id: string }) => h.recording_id);
      }
      if (!ids.length) {
        const { data: recent } = await client.from('recordings').select('id').eq('status', 'ready').order('created_at', { ascending: false }).limit(5);
        ids = (recent ?? []).map((r: { id: string }) => r.id);
      }
      if (!ids.length) return json({ answer: "You don't have any processed recordings yet.", sources: [] });

      const [{ data: recs }, { data: trs }, { data: sums }] = await Promise.all([
        client.from('recordings').select('id, title, created_at').in('id', ids),
        client.from('transcripts').select('recording_id, utterances, speaker_names').in('recording_id', ids),
        client.from('summaries').select('recording_id, overview').in('recording_id', ids),
      ]);
      sources = (recs ?? []) as Rec[];
      const parts: string[] = [];
      for (const rec of sources) {
        const tr = trs?.find((t) => t.recording_id === rec.id);
        const sum = sums?.find((s) => s.recording_id === rec.id);
        const excerpt = relevantLines((tr?.utterances ?? []) as Utterance[], words, tr?.speaker_names ?? {});
        parts.push(`## ${rec.title} (${rec.created_at.slice(0, 10)})\nSummary: ${sum?.overview ?? ''}\n${excerpt}`);
      }
      context = parts.join('\n\n').slice(0, MAX_CONTEXT_CHARS);
    }

    const answer = await claudeText(ASK_SYSTEM, [
      { role: 'user', content: `Material:\n\n${context}\n\nQuestion: ${question}` },
    ]);
    return json({ answer, sources: sources.map((s) => ({ recording_id: s.id, title: s.title })) });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

/** Lines that mention a query word, with one line of context either side (max 60 lines). */
function relevantLines(utterances: Utterance[], words: string[], names: Record<string, string>): string {
  if (!words.length) return formatTranscript(utterances.slice(0, 60), names);
  const keep = new Set<number>();
  utterances.forEach((u, i) => {
    const t = ' ' + normalize(u.text) + ' ';
    if (words.some((w) => t.includes(' ' + w + ' '))) [i - 1, i, i + 1].forEach((j) => keep.add(j));
  });
  return [...keep]
    .filter((i) => i >= 0 && i < utterances.length)
    .sort((a, b) => a - b)
    .slice(0, 60)
    .map((i) => `[${formatClock(utterances[i].start_ms)}] ${speakerLabel(utterances[i].speaker, names)}: ${utterances[i].text}`)
    .join('\n');
}
