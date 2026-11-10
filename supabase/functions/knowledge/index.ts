// POST /extract { recording_id } → extract a knowledge graph (entities + assertions)
// from a recording's verified notes and persist it as proposed, human-reviewable rows.
// Owner-only; the writes go through the service role after an ownership check.
import { adminClient, corsHeaders, HttpError, json, llmStructured, requireUser } from '../_shared/services.ts';

const KINDS = ['person', 'organization', 'project', 'topic', 'product', 'location', 'event', 'risk', 'other'];

const EXTRACT_SYSTEM =
  'You build a knowledge graph from verified meeting notes. Extract only what the notes ' +
  'actually state — never invent people, organizations, facts or relationships. ' +
  'Entities are named things; assertions are simple subject→predicate→object/value facts. ' +
  'Give each assertion a confidence from 0 to 1. Use short, canonical predicate verbs.';

const EXTRACT_TOOL = {
  name: 'extract_knowledge',
  description: 'Extract entities and assertions from the notes.',
  input_schema: {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: KINDS },
            aliases: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'kind'],
        },
      },
      assertions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Entity name (must match an entity).' },
            predicate: { type: 'string' },
            object: { type: ['string', 'null'], description: 'Entity name, or null for a value fact.' },
            value: { type: ['string', 'null'] },
            confidence: { type: 'number' },
          },
          required: ['subject', 'predicate'],
        },
      },
    },
    required: ['entities', 'assertions'],
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { id: userId, client } = await requireUser(req);
    const { recording_id } = await req.json();
    if (!recording_id) throw new HttpError(400, 'recording_id is required');

    const { data: rec } = await client.from('recordings').select('id, user_id').eq('id', recording_id).maybeSingle();
    if (!rec) throw new HttpError(404, 'Recording not found');
    if (rec.user_id !== userId) throw new HttpError(403, 'Only the person who made this recording can extract its knowledge');

    const { data: sum } = await client.from('summaries').select('overview, key_points, decisions, detailed_sections').eq('recording_id', recording_id).maybeSingle();
    if (!sum) throw new HttpError(409, 'No notes to extract from yet');

    const sections = (sum.detailed_sections as { heading: string; paragraphs: string[] }[] | null) ?? [];
    const material = [
      sum.overview,
      ...((sum.key_points as string[] | null) ?? []).map((k) => `- ${k}`),
      ...((sum.decisions as { text: string; verified: boolean }[] | null) ?? []).filter((d) => d.verified).map((d) => `Decision: ${d.text}`),
      ...sections.map((s) => `${s.heading}\n${(s.paragraphs ?? []).join('\n')}`),
    ].filter(Boolean).join('\n');

    const out = await llmStructured<{
      entities: { name: string; kind: string; aliases?: string[] }[];
      assertions: { subject: string; predicate: string; object?: string | null; value?: string | null; confidence?: number }[];
    }>(EXTRACT_SYSTEM, [{ role: 'user', content: material || 'No notes.' }], EXTRACT_TOOL);

    const admin = adminClient();
    const ids = new Map<string, string>();
    for (const e of out.entities ?? []) {
      const name = String(e.name ?? '').trim();
      if (!name) continue;
      const kind = KINDS.includes(e.kind) ? e.kind : 'other';
      const { data: ent } = await admin.from('knowledge_entities').upsert({ user_id: userId, kind, name }, { onConflict: 'user_id,kind,name' }).select('id').single();
      if (!ent?.id) continue;
      ids.set(name.toLowerCase(), ent.id as string);
      for (const a of e.aliases ?? []) {
        const alias = String(a).trim();
        if (alias && alias.toLowerCase() !== name.toLowerCase()) {
          await admin.from('knowledge_aliases').upsert({ entity_id: ent.id, alias }, { onConflict: 'entity_id,alias' }).select('id');
        }
      }
    }

    let inserted = 0;
    for (const a of out.assertions ?? []) {
      const subject = String(a.subject ?? '').trim();
      const subjectId = ids.get(subject.toLowerCase());
      if (!subjectId) continue;
      const objName = a.object ? String(a.object).trim() : '';
      const objectId = objName ? ids.get(objName.toLowerCase()) ?? null : null;
      const confidence = Math.max(0, Math.min(1, typeof a.confidence === 'number' ? a.confidence : 0));
      const { error } = await admin.from('knowledge_assertions').insert({
        user_id: userId,
        subject_id: subjectId,
        predicate: String(a.predicate ?? '').trim(),
        object_id: objectId,
        value: a.value ? String(a.value).trim() : null,
        source_refs: [{ recordingId: recording_id, verificationStatus: 'unverified' }],
        confidence,
        review_status: 'proposed',
      });
      if (!error) inserted++;
    }

    return json({ entities: (out.entities ?? []).length, assertions: inserted });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});
