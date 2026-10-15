// POST { recording_id } — transcribes every segment, writes notes and verified tasks.
// Returns 202 immediately; the work continues in the background and the app polls status.
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { runPipeline } from '../_shared/pipeline.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { id: userId, client } = await requireUser(req);
    const { recording_id } = await req.json();
    if (!recording_id) throw new HttpError(400, 'recording_id is required');

    // Ownership check through RLS: the caller can only see their own rows.
    const { data: rec, error } = await client.from('recordings').select('*').eq('id', recording_id).single();
    if (error || !rec) throw new HttpError(404, 'Recording not found');
    // Teammates can read shared recordings, but only the person who made one can re-run it.
    if (rec.user_id !== userId) throw new HttpError(403, 'Only the person who made this recording can re-run its notes');
    if (rec.status === 'transcribing' || rec.status === 'summarizing') {
      return json({ status: rec.status }, 202);
    }

    const admin = adminClient();
    await admin.from('recordings').update({ status: 'transcribing', error: null }).eq('id', recording_id);
    EdgeRuntime.waitUntil(runPipeline(recording_id));
    return json({ status: 'transcribing' }, 202);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

