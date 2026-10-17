// POST { recording_id } — transcribes every segment, writes notes and verified tasks.
// Returns 202 immediately; the work continues in the background and the app polls status.
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { internalSecret, runPipeline } from '../_shared/pipeline.ts';
import { assignPhotos, attachPhotosToLog, type PhotoMark, type SiteLog } from '../_shared/field.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // A long recording handing over to a fresh run (from the pipeline itself).
  if (new URL(req.url).pathname.endsWith('/continue')) {
    const secret = internalSecret();
    if (!secret || req.headers.get('x-internal-secret') !== secret) return json({ error: 'Forbidden' }, 403);
    const { recording_id } = await req.json();
    EdgeRuntime.waitUntil(runPipeline(String(recording_id)));
    return json({ status: 'continuing' }, 202);
  }
  try {
    const { id: userId, client } = await requireUser(req);
    if (new URL(req.url).pathname.endsWith('/relink-photos')) return await relinkPhotos(userId, client, await req.json());
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
    await admin.from('recordings').update({ status: 'transcribing', error: null, process_attempts: 0 }).eq('id', recording_id);
    EdgeRuntime.waitUntil(runPipeline(recording_id));
    return json({ status: 'transcribing' }, 202);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});


/** A photo added after the notes were made: re-match photos to tasks and the site log (no AI). */
// deno-lint-ignore no-explicit-any
async function relinkPhotos(userId: string, client: any, body: { recording_id?: string }) {
  const { data: rec } = await client.from('recordings').select('id, user_id, status').eq('id', body.recording_id ?? '').maybeSingle();
  if (!rec) throw new HttpError(404, 'Recording not found');
  if (rec.user_id !== userId) throw new HttpError(403, 'Only the person who made this recording can do this');
  if (rec.status !== 'ready') return json({ ok: true, skipped: 'not ready' });
  const admin = adminClient();
  const [{ data: photos }, { data: tasks }, { data: sum }] = await Promise.all([
    admin.from('recording_photos').select('id, taken_ms').eq('recording_id', rec.id),
    admin.from('tasks').select('id, quote_ms, verified').eq('recording_id', rec.id).order('created_at'),
    admin.from('summaries').select('site_log').eq('recording_id', rec.id).maybeSingle(),
  ]);
  const marks = (photos ?? []) as PhotoMark[];
  const list = (tasks ?? []) as { id: string; quote_ms: number | null; verified: boolean }[];
  const assigned = assignPhotos(list, marks);
  await Promise.all(list.map((t, i) => admin.from('tasks').update({ photo_ids: assigned[i] }).eq('id', t.id)));
  if (sum?.site_log) await admin.from('summaries').update({ site_log: attachPhotosToLog(sum.site_log as SiteLog, marks) }).eq('recording_id', rec.id);
  return json({ ok: true });
}
