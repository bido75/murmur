// POST { recording_id } — transcribes every segment, writes notes and verified tasks.
// Returns 202 immediately; the work continues in the background and the app polls status.
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { internalSecret, runPipeline } from '../_shared/pipeline.ts';
import { deferNotes, notesAllowed } from '../_shared/billing_store.ts';
import { assignPhotos, attachPhotosToLog, type PhotoMark, type SiteLog } from '../_shared/field.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // A long recording handing over to a fresh run (from the pipeline itself).
  if (new URL(req.url).pathname.endsWith('/continue')) {
    const secret = internalSecret();
    if (!secret || req.headers.get('x-internal-secret') !== secret) return json({ error: 'Forbidden' }, 403);
    const { recording_id } = await req.json();
    EdgeRuntime.waitUntil(runPipeline(String(recording_id), { skipLimit: true }));
    return json({ status: 'continuing' }, 202);
  }
  try {
    const { id: userId, client } = await requireUser(req);
    if (new URL(req.url).pathname.endsWith('/relink-photos')) return await relinkPhotos(userId, client, await req.json());
    if (new URL(req.url).pathname.endsWith('/regenerate')) return await regenerateNotes(userId, client, await req.json());
    if (new URL(req.url).pathname.endsWith('/restore-version')) return await restoreVersion(userId, await req.json());
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

    // Out of minutes: the recording waits for its notes and the audio stays exactly where it is.
    const gate = await notesAllowed(userId, new Date());
    if (!gate.allowed) {
      await deferNotes(recording_id, gate.message);
      return json({ status: 'waiting', message: gate.message }, 202);
    }

    const admin = adminClient();
    // The notes are being made, so the recording is no longer waiting for minutes.
    await admin.from('recordings').update({ status: 'transcribing', error: null, notes_queued_at: null, process_attempts: 0 }).eq('id', recording_id);
    EdgeRuntime.waitUntil(runPipeline(recording_id));
    return json({ status: 'transcribing' }, 202);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});


/** Regenerate notes from the stored transcript — no re-transcription or re-upload.
 * Uses the existing transcript, so it is fast and does not re-run speech-to-text. */
// deno-lint-ignore no-explicit-any
async function regenerateNotes(userId: string, client: any, body: { recording_id?: string; detail_level?: string }) {
  const recording_id = String(body.recording_id ?? '');
  if (!recording_id) throw new HttpError(400, 'recording_id is required');
  const { data: rec } = await client.from('recordings').select('id, user_id, status').eq('id', recording_id).maybeSingle();
  if (!rec) throw new HttpError(404, 'Recording not found');
  if (rec.user_id !== userId) throw new HttpError(403, 'Only the person who made this recording can regenerate its notes');
  const admin = adminClient();
  const { data: t } = await admin.from('transcripts').select('id').eq('recording_id', recording_id).maybeSingle();
  if (!t) throw new HttpError(409, 'No transcript to regenerate from');
  // Prevent duplicate concurrent regeneration jobs.
  if (rec.status === 'recording' || rec.status === 'transcribing' || rec.status === 'summarizing') {
    return json({ status: rec.status }, 202);
  }
  const level = body.detail_level;
  const detailLevel = level === 'brief' || level === 'standard' || level === 'detailed' ? level : undefined;
  await admin.from('recordings').update({ status: 'transcribing', error: null, notes_queued_at: null, process_attempts: 0 }).eq('id', recording_id);
  EdgeRuntime.waitUntil(runPipeline(recording_id, { skipLimit: true, reuseTranscript: true, detailLevel }));
  return json({ status: 'regenerating' }, 202);
}

/** Restore a prior note snapshot back onto the summary (note fields only, never the
 * identity columns). Owner-only. */
// deno-lint-ignore no-explicit-any
async function restoreVersion(userId: string, body: { version_id?: string }) {
  const version_id = String(body.version_id ?? '');
  if (!version_id) throw new HttpError(400, 'version_id is required');
  const admin = adminClient();
  const { data: v } = await admin.from('note_versions').select('recording_id, user_id, summary').eq('id', version_id).maybeSingle();
  if (!v) throw new HttpError(404, 'Version not found');
  if (v.user_id !== userId) throw new HttpError(403, 'Only the person who made this recording can restore its notes');
  const s = v.summary as Record<string, unknown>;
  const patch = {
    overview: (s.overview as string) ?? '',
    key_points: (s.key_points as unknown[]) ?? [],
    key_point_details: (s.key_point_details as unknown[]) ?? [],
    decisions: (s.decisions as unknown[]) ?? [],
    open_questions: (s.open_questions as unknown[]) ?? [],
    task_updates: (s.task_updates as unknown[]) ?? [],
    site_log: (s.site_log as unknown) ?? null,
    site_log_external: (s.site_log_external as unknown) ?? null,
    detailed_sections: (s.detailed_sections as unknown) ?? null,
    conclusions: (s.conclusions as unknown[]) ?? [],
    detail_level: (s.detail_level as string) ?? 'detailed',
    notes_schema_version: (s.notes_schema_version as number) ?? 1,
  };
  const { error } = await admin.from('summaries').update(patch).eq('recording_id', v.recording_id);
  if (error) throw new Error(error.message);
  return json({ ok: true });
}

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
