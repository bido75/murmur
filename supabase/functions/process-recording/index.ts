// POST { recording_id } — transcribes every segment, writes notes and verified tasks.
// Returns 202 immediately; the work continues in the background and the app polls status.
import { adminClient, claudeStructured, corsHeaders, HttpError, json, requireUser, transcribe } from '../_shared/services.ts';
import { notesTool, systemPrompt, userMessage, type NotesOutput } from '../_shared/prompts.ts';
import { assignPhotos, attachPhotosToLog, buildKeyterms, siteLogIsEmpty, verifySiteLog, type PhotoMark } from '../_shared/field.ts';
import {
  dropRepeats,
  findQuote,
  formatTranscript,
  makeRefs,
  offsetUtterances,
  verifyActionItems,
  verifyTaskUpdates,
  type Utterance,
} from '../_shared/verify.ts';

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
    EdgeRuntime.waitUntil(run(recording_id, userId, rec.template, rec.title, rec.project_id));
    return json({ status: 'transcribing' }, 202);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

async function run(recordingId: string, userId: string, template: string, currentTitle: string, projectId: string | null) {
  const admin = adminClient();
  try {
    const { data: segments, error } = await admin
      .from('recording_segments')
      .select('idx, storage_path, duration_ms')
      .eq('recording_id', recordingId)
      .order('idx');
    if (error) throw error;
    if (!segments?.length) throw new Error('No audio was uploaded for this recording');

    // 0. Hints for the transcriber: the project's words, its name and people's names.
    const keyterms = await keytermsFor(projectId, template);

    // 1. Transcribe each segment and place it on the recording's timeline.
    let offset = 0;
    let language: string | null = null;
    const all: Utterance[] = [];
    for (const seg of segments) {
      const { data: signed, error: signErr } = await admin.storage.from('audio').createSignedUrl(seg.storage_path, 60 * 60);
      if (signErr || !signed) throw new Error(`Could not read audio segment ${seg.idx}`);
      const result = await transcribe(signed.signedUrl, keyterms);
      all.push(...offsetUtterances(result.utterances, offset));
      language = language ?? result.language;
      offset += result.durationMs || seg.duration_ms;
    }

    const text = all.map((u) => u.text).join(' ');
    await admin.from('transcripts').upsert({ recording_id: recordingId, user_id: userId, utterances: all, text });
    await admin.from('recordings').update({ status: 'summarizing', duration_ms: offset, language }).eq('id', recordingId);

    if (all.length === 0) {
      await admin.from('summaries').upsert({
        recording_id: recordingId,
        user_id: userId,
        overview: 'No speech was detected in this recording.',
      });
      await admin.from('recordings').update({ status: 'ready' }).eq('id', recordingId);
      return;
    }

    // 2. Open tasks from earlier recordings in the same project (the carry-over brief).
    const openTasks = projectId ? await openProjectTasks(projectId, recordingId) : [];
    const refs = makeRefs(openTasks);

    // 3. Structured notes from Claude.
    const notes = await claudeStructured<NotesOutput>(
      systemPrompt(template),
      [{ role: 'user', content: userMessage(formatTranscript(all), refs) }],
      notesTool(template),
    );

    // 4. Check every task, decision and update against the transcript before saving.
    const tasks = dropRepeats(verifyActionItems(notes.action_items ?? [], all), openTasks.map((t) => t.text));

    // Photos taken while recording are linked to what was being said when they were taken.
    const { data: photoRows } = await admin.from('recording_photos').select('id, taken_ms').eq('recording_id', recordingId);
    const photos = (photoRows ?? []) as PhotoMark[];
    const taskPhotos = assignPhotos(tasks, photos);
    let siteLog = template === 'site_walk' ? attachPhotosToLog(verifySiteLog(notes.site_log, all), photos) : null;
    if (siteLogIsEmpty(siteLog)) siteLog = null;
    const updates = verifyTaskUpdates(notes.task_updates ?? [], refs, all);
    for (const u of updates.filter((x) => x.verified)) {
      const patch =
        u.status === 'done'
          ? { status: 'done', completed_by_recording_id: recordingId, completion_quote: u.quote, completion_ms: u.quote_ms, progress_note: u.note }
          : { progress_note: [u.status === 'blocked' ? 'Blocked' : 'In progress', u.note].filter(Boolean).join(': ') };
      // u.task_id came from this project's own open tasks (see openProjectTasks), so it may
      // belong to a teammate's recording in the same project.
      await admin.from('tasks').update(patch).eq('id', u.task_id).eq('status', 'open');
    }
    const decisions = (notes.decisions ?? []).map((d) => {
      const m = findQuote(d.quote, all);
      return { text: d.text, quote: d.quote, quote_ms: m.start_ms, verified: m.found };
    });

    await admin.from('summaries').upsert({
      recording_id: recordingId,
      user_id: userId,
      overview: notes.overview ?? '',
      key_points: notes.key_points ?? [],
      decisions,
      open_questions: notes.open_questions ?? [],
      task_updates: updates,
      site_log: siteLog,
      model: Deno.env.get('CLAUDE_MODEL') ?? 'claude-sonnet-5-5',
    });

    // Reprocessing replaces this recording's AI tasks.
    await admin.from('tasks').delete().eq('recording_id', recordingId);
    if (tasks.length) {
      await admin.from('tasks').insert(tasks.map((t, i) => ({ ...t, photo_ids: taskPhotos[i], recording_id: recordingId, user_id: userId })));
    }

    const update: Record<string, unknown> = { status: 'ready' };
    if (notes.title && (!currentTitle || currentTitle === 'New recording')) update.title = notes.title.slice(0, 120);
    await admin.from('recordings').update(update).eq('id', recordingId);
  } catch (e) {
    console.error('process-recording failed', recordingId, e);
    await admin
      .from('recordings')
      .update({ status: 'failed', error: (e as Error).message.slice(0, 500) })
      .eq('id', recordingId);
  }
}

/** Open, confirmed tasks from this project's other recordings (newest first, max 40). */
async function openProjectTasks(projectId: string, recordingId: string): Promise<{ id: string; text: string }[]> {
  const admin = adminClient();
  const { data: recs } = await admin.from('recordings').select('id').eq('project_id', projectId).neq('id', recordingId);
  const ids = (recs ?? []).map((r: { id: string }) => r.id);
  if (!ids.length) return [];
  const { data } = await admin
    .from('tasks')
    .select('id, text')
    .in('recording_id', ids)
    .eq('status', 'open')
    .eq('needs_review', false)
    .order('created_at', { ascending: false })
    .limit(40);
  return (data ?? []) as { id: string; text: string }[];
}

/** Words to listen for: the project's vocabulary and name, plus names people gave speakers before. */
async function keytermsFor(projectId: string | null, template: string): Promise<string[]> {
  if (!projectId) return buildKeyterms({ template });
  const admin = adminClient();
  const { data: project } = await admin.from('projects').select('name, vocabulary').eq('id', projectId).maybeSingle();
  const { data: recs } = await admin.from('recordings').select('id').eq('project_id', projectId).order('created_at', { ascending: false }).limit(20);
  const ids = (recs ?? []).map((r: { id: string }) => r.id);
  const names: string[] = [];
  if (ids.length) {
    const { data: ts } = await admin.from('transcripts').select('speaker_names').in('recording_id', ids);
    for (const t of (ts ?? []) as { speaker_names: Record<string, string> | null }[]) names.push(...Object.values(t.speaker_names ?? {}));
  }
  return buildKeyterms({ vocabulary: project?.vocabulary ?? [], projectName: project?.name ?? null, names, template });
}
