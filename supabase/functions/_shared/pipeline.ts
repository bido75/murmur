// The processing pipeline: transcribe every segment, write notes and verified tasks, link photos.
// Shared by process-recording (user-triggered) and the meeting bot webhook.
import { adminClient, claudeStructured, transcribe } from './services.ts';
import { notesTool, systemPrompt, userMessage, type NotesOutput } from './prompts.ts';
import { normalizeMediaLink } from './links.ts';
import { notifyUser } from './push.ts';
import { assignPhotos, attachPhotosToLog, buildKeyterms, siteLogIsEmpty, verifySiteLog, type PhotoMark } from './field.ts';
import {
  dropRepeats,
  findQuote,
  formatTranscript,
  makeRefs,
  offsetUtterances,
  verifyActionItems,
  verifyTaskUpdates,
  type Utterance,
} from './verify.ts';

export async function runPipeline(recordingId: string) {
  const admin = adminClient();
  const { data: rec } = await admin
    .from('recordings')
    .select('user_id, template, title, project_id, custom_template_id, audio_deleted_at, user_notes')
    .eq('id', recordingId)
    .single();
  if (!rec) return;
  const userId = rec.user_id as string;
  const template = rec.template as string;
  const currentTitle = rec.title as string;
  const projectId = rec.project_id as string | null;
  let custom: string | null = null;
  if (rec.custom_template_id) {
    const { data: t } = await admin.from('summary_templates').select('instructions').eq('id', rec.custom_template_id).maybeSingle();
    custom = (t?.instructions as string | undefined) ?? null;
  }
  await run(recordingId, userId, template, currentTitle, projectId, custom, Boolean(rec.audio_deleted_at), (rec.user_notes as string | null) ?? null);
}

async function run(recordingId: string, userId: string, template: string, currentTitle: string, projectId: string | null, custom: string | null, audioDeleted: boolean, userNotes: string | null) {
  const admin = adminClient();
  try {
    // Corrected transcripts (and ones whose audio retention removed) are reused, not re-transcribed.
    const { data: existing } = await admin.from('transcripts').select('utterances, speaker_names, edited_at').eq('recording_id', recordingId).maybeSingle();
    const speakerNames = ((existing?.speaker_names as Record<string, string> | null) ?? {}) as Record<string, string>;
    const reuse = Boolean((existing?.edited_at || audioDeleted) && (existing?.utterances as Utterance[] | null)?.length);

    let offset = 0;
    let language: string | null = null;
    let all: Utterance[] = [];
    if (reuse) {
      all = existing!.utterances as Utterance[];
      offset = Math.max(0, ...all.map((u) => u.end_ms));
    } else {
      const { data: segments, error } = await admin
        .from('recording_segments')
        .select('idx, storage_path, source_url, duration_ms')
        .eq('recording_id', recordingId)
        .order('idx');
      if (error) throw error;
      if (audioDeleted) throw new Error('The audio was removed by your retention setting, so this recording can’t be processed again.');
      if (!segments?.length) throw new Error('No audio was uploaded for this recording');

      // 0. Hints for the transcriber: the project's words, its name and people's names;
      //    and the owner's language and redaction choices.
      const keyterms = await keytermsFor(projectId, template);
      const sttOpts = await sttOptionsFor(userId, projectId);

      // 1. Transcribe each segment and place it on the recording's timeline.
      for (const seg of segments) {
        let audioUrl: string;
        if (seg.storage_path) {
          const { data: signed, error: signErr } = await admin.storage.from('audio').createSignedUrl(seg.storage_path, 60 * 60);
          if (signErr || !signed) throw new Error(`Could not read audio segment ${seg.idx}`);
          audioUrl = signed.signedUrl;
        } else {
          // Imported from a link: checked again here, then the transcriber downloads it directly.
          const check = normalizeMediaLink(String(seg.source_url ?? ''));
          if (!check.ok) throw new Error(check.reason);
          audioUrl = check.url;
        }
        const result = await transcribe(audioUrl, keyterms, sttOpts).catch((e) => {
          if (!seg.storage_path) throw new Error(`Couldn't download audio from that link. Check it's public and points to an audio or video file. (${(e as Error).message.slice(0, 160)})`);
          throw e;
        });
        all.push(...offsetUtterances(result.utterances, offset));
        language = language ?? result.language;
        offset += result.durationMs || seg.duration_ms;
      }

      const text = all.map((u) => u.text).join(' ');
      await admin.from('transcripts').upsert({ recording_id: recordingId, user_id: userId, utterances: all, text });
    }
    await admin.from('recordings').update({ status: 'summarizing', duration_ms: offset, ...(language ? { language } : {}) }).eq('id', recordingId);

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
      systemPrompt(template, custom),
      [{ role: 'user', content: userMessage(formatTranscript(all, speakerNames), refs, userNotes) }],
      notesTool(template),
    );

    // 4. Check every task, decision and update against the transcript before saving.
    const tasks = dropRepeats(verifyActionItems(notes.action_items ?? [], all, speakerNames), openTasks.map((t) => t.text));

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
    await afterReady(recordingId, userId, (update.title as string | undefined) ?? currentTitle, tasks.filter((t) => !t.needs_review).length);
  } catch (e) {
    console.error('process-recording failed', recordingId, e);
    await admin
      .from('recordings')
      .update({ status: 'failed', error: (e as Error).message.slice(0, 500) })
      .eq('id', recordingId);
    await notifyUser(userId, { title: 'Couldn’t process a recording', body: (e as Error).message.slice(0, 200), data: { recording_id: recordingId } });
  }
}

/** Everything that happens once notes are ready: notifications now; webhooks and automations hook in here. */
export async function afterReady(recordingId: string, userId: string, title: string, taskCount: number) {
  await notifyUser(userId, {
    title: 'Notes ready',
    body: `${title}${taskCount ? ` · ${taskCount} action item${taskCount > 1 ? 's' : ''}` : ''}`,
    data: { recording_id: recordingId },
  });
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

/** The recording owner's language and redaction settings; a team's redaction policy adds to them. */
async function sttOptionsFor(userId: string, projectId: string | null): Promise<{ language: string | null; redact: string[] }> {
  const admin = adminClient();
  const { data } = await admin.from('user_settings').select('language, redact').eq('user_id', userId).maybeSingle();
  const redact = new Set<string>((data?.redact as string[] | null) ?? []);
  if (projectId) {
    const { data: p } = await admin.from('projects').select('workspace_id').eq('id', projectId).maybeSingle();
    if (p?.workspace_id) {
      const { data: w } = await admin.from('workspace_policies').select('redact').eq('workspace_id', p.workspace_id).maybeSingle();
      for (const r of (w?.redact as string[] | null) ?? []) redact.add(r);
    }
  }
  return { language: (data?.language as string | null) ?? null, redact: [...redact] };
}
