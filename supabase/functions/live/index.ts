// POST /token → a short-lived Deepgram token for the live transcript shown while recording
// (browser and desktop app). The final transcript still comes from the normal pipeline.
// An optional recording_id lets the live stream reuse the recording's vocabulary and
// speaker names as keyterm hints.
import { corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { liveParams } from '../_shared/stt.ts';
import { buildKeyterms } from '../_shared/field.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { client } = await requireUser(req);
    const key = Deno.env.get('DEEPGRAM_API_KEY');
    if (!key) throw new HttpError(503, 'Transcription is not set up.');
    const body = await req.json().catch(() => ({}));
    const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    const grant = await res.json().catch(() => ({}));
    if (!res.ok || !grant.access_token) throw new Error(`Couldn't start the live transcript (${res.status})`);
    const { data: s } = await client.from('user_settings').select('language, redact').maybeSingle();
    const keyterms = body.recording_id ? await keytermsFor(client, String(body.recording_id)) : [];
    const params = liveParams({ language: s?.language ?? null, redact: s?.redact ?? [], keyterms });
    return json({ token: grant.access_token, url: `wss://api.deepgram.com/v1/listen?${params}` });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

/** The recording's project vocabulary + name + recent speaker names, as keyterm hints. */
async function keytermsFor(client: Supa, recordingId: string): Promise<string[]> {
  const { data: rec } = await client.from('recordings').select('project_id, template').eq('id', recordingId).maybeSingle();
  const template = (rec?.template as string | undefined) ?? 'general';
  if (!rec?.project_id) return buildKeyterms({ template });
  const { data: project } = await client.from('projects').select('name, vocabulary').eq('id', rec.project_id).maybeSingle();
  const { data: recs } = await client.from('recordings').select('id').eq('project_id', rec.project_id).order('created_at', { ascending: false }).limit(20);
  const ids = (recs ?? []).map((r: { id: string }) => r.id);
  const names: string[] = [];
  if (ids.length) {
    const { data: ts } = await client.from('transcripts').select('speaker_names').in('recording_id', ids);
    for (const t of (ts ?? []) as { speaker_names: Record<string, string> | null }[]) names.push(...Object.values(t.speaker_names ?? {}));
  }
  return buildKeyterms({ vocabulary: (project?.vocabulary as string[] | undefined) ?? [], projectName: (project?.name as string | undefined) ?? null, names, template });
}
