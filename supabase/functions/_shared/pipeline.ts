// The processing pipeline: transcribe every segment, write notes and verified tasks, link photos.
// Shared by process-recording (user-triggered) and the meeting bot webhook.
import { adminClient, claudeStructured, transcribe } from './services.ts';
import { userFacingError } from './errors.ts';
import { deferNotes, notesAllowed } from './billing_store.ts';
import { notesTool, systemPrompt, userMessage, type NotesOutput } from './prompts.ts';
import { boundaryExcerpt, joinParts, mapLimited, mergeChannels, parseSpeakerMap, speakersIn, sttCacheKey } from './parts.ts';
import { normalizeMediaLink } from './links.ts';
import { notifyUser } from './push.ts';
import { runAfterReady, runFailedHooks } from './after_ready.ts';
import { assignPhotos, attachPhotosToLog, buildKeyterms, siteLogIsEmpty, verifySiteLog, type PhotoMark } from './field.ts';
import {
  dropRepeats,
  findQuote,
  formatTranscript,
  makeRefs,
  offsetUtterances,
  verifyActionItems,
  verifyKeyPoints,
  verifyTaskUpdates,
  type Utterance,
} from './verify.ts';

export async function runPipeline(recordingId: string, opts: { skipLimit?: boolean } = {}) {
  const admin = adminClient();
  const { data: rec } = await admin
    .from('recordings')
    .select('user_id, template, title, project_id, custom_template_id, audio_deleted_at, user_notes, transcribed_on_device, channels')
    .eq('id', recordingId)
    .single();
  if (!rec) return;
  const userId = rec.user_id as string;
  const template = rec.template as string;
  const currentTitle = rec.title as string;
  const projectId = rec.project_id as string | null;

  // A recording made on a plan that has run out waits for more minutes. The audio stays put.
  if (!opts.skipLimit) {
    const gate = await notesAllowed(userId, new Date());
    if (!gate.allowed) {
      await deferNotes(recordingId, gate.message);
      return;
    }
  }

  let custom: string | null = null;
  if (rec.custom_template_id) {
    const { data: t } = await admin.from('summary_templates').select('instructions').eq('id', rec.custom_template_id).maybeSingle();
    custom = (t?.instructions as string | undefined) ?? null;
  }
  await run(recordingId, userId, template, currentTitle, projectId, custom, Boolean(rec.audio_deleted_at || rec.transcribed_on_device), (rec.user_notes as string | null) ?? null, Number(rec.channels ?? 1) === 2);
}

async function run(recordingId: string, userId: string, template: string, currentTitle: string, projectId: string | null, custom: string | null, audioDeleted: boolean, userNotes: string | null, twoChannel = false) {
  const admin = adminClient();
  const startedAt = Date.now();
  try {
    // Corrected transcripts (and ones whose audio retention removed, or made on the phone) are reused, not re-transcribed.
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

      // 1. Transcribe the parts (four at a time). Each part's transcript is saved as soon as it's
      //    done, so if this run nears the server's time limit it hands over to a fresh run that
      //    picks up where it stopped.
      const cacheKey = sttCacheKey({ keyterms, language: sttOpts.language, redact: sttOpts.redact, multichannel: twoChannel, model: Deno.env.get('DEEPGRAM_MODEL') ?? 'nova-3' });
      const { data: cachedRows } = await admin.from('segment_transcripts').select('idx, cache_key, utterances, duration_ms, language').eq('recording_id', recordingId);
      const cached = new Map((cachedRows ?? []).filter((r) => r.cache_key === cacheKey).map((r) => [r.idx as number, r]));
      const budgetMs = Number(Deno.env.get('PIPELINE_BUDGET_MS') ?? 240_000);
      let handedOver = false;
      const results = await mapLimited(segments, 4, async (seg) => {
        const hit = cached.get(seg.idx);
        if (hit) return { utterances: hit.utterances as Utterance[], durationMs: hit.duration_ms as number, language: (hit.language as string | null) ?? null };
        if (handedOver || Date.now() - startedAt > budgetMs) {
          handedOver = true;
          return null;
        }
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
        const r = await transcribe(audioUrl, keyterms, { ...sttOpts, multichannel: twoChannel }).catch((e) => {
          if (!seg.storage_path) throw new Error(`Couldn't download audio from that link. Check it's public and points to an audio or video file. (${(e as Error).message.slice(0, 160)})`);
          throw e;
        });
        const utterances = twoChannel ? mergeChannels(r.utterances) : r.utterances;
        const out = { utterances, durationMs: r.durationMs || seg.duration_ms, language: r.language };
        await admin.from('segment_transcripts').upsert({ recording_id: recordingId, idx: seg.idx, cache_key: cacheKey, utterances, duration_ms: out.durationMs, language: r.language });
        // A part imported from a link is copied into our storage, so playback keeps working if the link goes away.
        if (!seg.storage_path && seg.source_url) await copyLinkedPart(recordingId, userId, seg.idx, audioUrl).catch((e) => console.warn('link copy failed', (e as Error).message));
        return out;
      });
      if (results.some((r) => r === null)) {
        await continueLater(recordingId);
        return;
      }
      const parts = results as { utterances: Utterance[]; durationMs: number; language: string | null }[];

      // 2. Speakers are numbered per part by the transcriber; match them up across the joins
      //    so "Speaker 2" is the same person all the way through.
      const joined = twoChannel ? parts.map((p) => p.utterances) : await matchSpeakers(parts.map((p) => p.utterances));
      parts.forEach((p, i) => {
        all.push(...offsetUtterances(joined[i], offset));
        language = language ?? p.language;
        offset += p.durationMs;
      });
      if (twoChannel && !speakerNames['0']) speakerNames['0'] = 'Me';

      const text = all.map((u) => u.text).join(' ');
      await admin.from('transcripts').upsert({ recording_id: recordingId, user_id: userId, utterances: all, text, ...(Object.keys(speakerNames).length ? { speaker_names: speakerNames } : {}) });
      await admin.from('segment_transcripts').delete().eq('recording_id', recordingId);
    }
    await admin.from('recordings').update({ status: 'summarizing', duration_ms: offset, ...(language ? { language } : {}) }).eq('id', recordingId);

    if (all.length === 0) {
      await admin.from('summaries').upsert({
        recording_id: recordingId,
        user_id: userId,
        overview: 'No speech was detected in this recording.',
      });
      await admin.from('recordings').update({ status: 'ready', notes_queued_at: null }).eq('id', recordingId);
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
    // Key points keep their text for sharing, search and export; the details carry the
    // quote and the time so the app can show where a point came from.
    const keyPoints = verifyKeyPoints(notes.key_points ?? [], all);

    await admin.from('summaries').upsert({
      recording_id: recordingId,
      user_id: userId,
      overview: notes.overview ?? '',
      key_points: keyPoints.map((k) => k.text),
      key_point_details: keyPoints,
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

    // notes_queued_at is cleared too: the notes exist now, so the recording is no longer waiting.
    const update: Record<string, unknown> = { status: 'ready', notes_queued_at: null };
    if (notes.title && (!currentTitle || currentTitle === 'New recording')) update.title = notes.title.slice(0, 120);
    await admin.from('recordings').update(update).eq('id', recordingId);
    await afterReady(recordingId, userId, (update.title as string | undefined) ?? currentTitle, tasks.filter((t) => !t.needs_review).length);
  } catch (e) {
    console.error('process-recording failed', recordingId, e);
    await admin
      .from('recordings')
      .update({ status: 'failed', error: userFacingError((e as Error).message).slice(0, 500) })
      .eq('id', recordingId);
    await notifyUser(userId, { title: 'Couldn’t process a recording', body: (e as Error).message.slice(0, 200), data: { recording_id: recordingId } });
    await runFailedHooks(recordingId, (e as Error).message.slice(0, 500)).catch(() => {});
  }
}

/** Everything that happens once notes are ready: notifications now; webhooks and automations hook in here. */
export async function afterReady(recordingId: string, userId: string, title: string, taskCount: number) {
  await notifyUser(userId, {
    title: 'Notes ready',
    body: `${title}${taskCount ? ` · ${taskCount} action item${taskCount > 1 ? 's' : ''}` : ''}`,
    data: { recording_id: recordingId },
  });
  await runAfterReady(recordingId).catch((e) => console.error('after-ready steps failed', recordingId, e));
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

/** Hand a long recording to a fresh run (each run has a time limit). Gives up after 20 runs. */
async function continueLater(recordingId: string) {
  const admin = adminClient();
  const { data: rec } = await admin.from('recordings').select('process_attempts').eq('id', recordingId).single();
  const attempts = Number(rec?.process_attempts ?? 0) + 1;
  if (attempts > 20) throw new Error('This recording is too long to process. Split it into shorter recordings and try again.');
  await admin.from('recordings').update({ process_attempts: attempts }).eq('id', recordingId);
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const res = await fetch(`${base}/functions/v1/process-recording/continue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`,
      'x-internal-secret': internalSecret(),
    },
    body: JSON.stringify({ recording_id: recordingId }),
  });
  if (!res.ok) throw new Error(`Couldn't continue processing (${res.status})`);
}

export function internalSecret(): string {
  return Deno.env.get('INTERNAL_SECRET') ?? Deno.env.get('CRON_SECRET') ?? '';
}

/** Ask Claude which speaker is which across each join, from the words either side of it. */
async function matchSpeakers(parts: Utterance[][]): Promise<Utterance[][]> {
  if (parts.length < 2 || parts.every((p) => speakersIn(p).length <= 1 && speakersIn(p)[0] === 0)) return joinParts(parts, []);
  const maps: Record<number, number | null>[] = [];
  for (let i = 1; i < parts.length; i++) {
    const a = speakersIn(parts[i - 1]);
    const b = speakersIn(parts[i]);
    if (!a.length || !b.length) {
      maps.push({});
      continue;
    }
    try {
      const ex = boundaryExcerpt(parts[i - 1], parts[i]);
      const out = await claudeStructured<{ matches: { b: number; a: number | null }[] }>(
        SPEAKER_MATCH_SYSTEM,
        [{ role: 'user', content: `End of part A (speakers ${a.map((s) => `A${s}`).join(', ')}):\n${ex.before}\n\nStart of part B, which continues right after (speakers ${b.map((s) => `B${s}`).join(', ')}):\n${ex.after}` }],
        SPEAKER_MATCH_TOOL,
      );
      maps.push(parseSpeakerMap(out.matches, b, a));
    } catch (e) {
      console.warn('speaker matching failed; keeping separate numbers', (e as Error).message);
      maps.push({});
    }
  }
  return joinParts(parts, maps);
}

const SPEAKER_MATCH_SYSTEM =
  'A recording was split into parts and each part had its speakers numbered separately. Part B continues straight after part A. ' +
  'Decide which speaker in B is which speaker in A, using names said, who was talking at the cut, who asks and answers, and topic continuity. ' +
  'Only match when you are fairly confident; otherwise say the B speaker is new (a: null). Never map two B speakers to the same A speaker.';

const SPEAKER_MATCH_TOOL = {
  name: 'speaker_matches',
  description: 'For each speaker in part B, the matching speaker number in part A, or null if new or unsure.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: { type: 'object', properties: { b: { type: 'integer' }, a: { type: ['integer', 'null'] } }, required: ['b', 'a'] },
      },
    },
    required: ['matches'],
  },
};

/** Stream a linked file into our storage (no full copy in memory) and point the part at it. */
async function copyLinkedPart(recordingId: string, userId: string, idx: number, url: string) {
  const maxBytes = Number(Deno.env.get('IMPORT_COPY_MAX_MB') ?? 2000) * 1024 * 1024;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new Error('file too large to copy');
  const type = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0];
  if (type.startsWith('text/')) throw new Error('not a media file');
  const ext = type.includes('video') ? 'mp4' : type.includes('mpeg') ? 'mp3' : type.includes('wav') ? 'wav' : type.includes('ogg') ? 'ogg' : type.includes('webm') ? 'webm' : 'm4a';
  const path = `${userId}/${recordingId}/seg-${String(idx).padStart(4, '0')}.${ext}`;
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const up = await fetch(`${base}/storage/v1/object/audio/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`, 'Content-Type': type, 'x-upsert': 'true' },
    body: res.body,
    // @ts-ignore Deno streams request bodies with duplex: 'half'
    duplex: 'half',
  });
  if (!up.ok) throw new Error(`storage ${up.status}: ${(await up.text()).slice(0, 120)}`);
  await adminClient().from('recording_segments').update({ storage_path: path }).eq('recording_id', recordingId).eq('idx', idx);
}
