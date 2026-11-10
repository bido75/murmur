// POST /agenda { project_id } → a suggested meeting agenda synthesized from the
// project's open tasks and recent decisions/questions. Read-only and RLS-scoped.
import { corsHeaders, HttpError, json, llmStructured, requireUser } from '../_shared/services.ts';

const AGENDA_SYSTEM =
  'You propose a short, focused meeting agenda from a project\'s open work. ' +
  'Use only the provided material; never invent tasks, decisions, names or dates. ' +
  'Return 3 to 7 concrete agenda items, each a single actionable topic under 12 words.';

const AGENDA_TOOL = {
  name: 'propose_agenda',
  description: 'Propose the meeting agenda.',
  input_schema: {
    type: 'object',
    properties: {
      agenda: { type: 'array', items: { type: 'string' } },
    },
    required: ['agenda'],
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { client } = await requireUser(req);
    const { project_id } = await req.json();
    if (!project_id) throw new HttpError(400, 'project_id is required');

    const { data: tasks } = await client
      .from('tasks')
      .select('text, owner, recordings!tasks_recording_id_fkey!inner(project_id)')
      .eq('recordings.project_id', project_id)
      .eq('status', 'open')
      .eq('needs_review', false)
      .order('created_at', { ascending: false })
      .limit(20);

    const { data: lastRec } = await client
      .from('recordings')
      .select('id, title')
      .eq('project_id', project_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let overview = '';
    let decisions: string[] = [];
    let questions: string[] = [];
    if (lastRec) {
      const { data: sum } = await client.from('summaries').select('overview, decisions, open_questions').eq('recording_id', lastRec.id).maybeSingle();
      overview = (sum?.overview as string) ?? '';
      decisions = ((sum?.decisions as { text: string; verified: boolean }[]) ?? []).filter((d) => d.verified).map((d) => d.text);
      questions = (sum?.open_questions as string[]) ?? [];
    }

    const material = [
      ...((tasks ?? []) as { text: string }[]).map((t) => `Open task: ${t.text}`),
      ...decisions.map((d) => `Last decision: ${d}`),
      ...questions.map((q) => `Open question: ${q}`),
      overview ? `Last meeting overview: ${overview}` : '',
    ].filter(Boolean).join('\n');

    const out = await llmStructured<{ agenda: string[] }>(
      AGENDA_SYSTEM,
      [{ role: 'user', content: material || 'No open work in this project.' }],
      AGENDA_TOOL,
    );
    return json({ agenda: (out.agenda ?? []).slice(0, 7) });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});
