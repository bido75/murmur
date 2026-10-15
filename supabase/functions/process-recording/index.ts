// POST { recording_id } — transcribes every segment, writes notes and verified tasks.
// Returns 202 immediately; the work continues in the background and the app polls status.
import { adminClient, claudeStructured, corsHeaders, HttpError, json, requireUser, transcribe } from '../_shared/services.ts';
import { NOTES_TOOL, systemPrompt, type NotesOutput } from '../_shared/prompts.ts';
import { findQuote, formatTranscript, offsetUtterances, verifyActionItems, type Utterance } from '../_shared/verify.ts';

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
    if (rec.status === 'transcribing' || rec.status === 'summarizing') {
      return json({ status: rec.status }, 202);
    }

    const admin = adminClient();
    await admin.from('recordings').update({ status: 'transcribing', error: null }).eq('id', recording_id);
    EdgeRuntime.waitUntil(run(recording_id, userId, rec.template, rec.title));
    return json({ status: 'transcribing' }, 202);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

async function run(recordingId: string, userId: string, template: string, currentTitle: string) {
  const admin = adminClient();
  try {
    const { data: segments, error } = await admin
      .from('recording_segments')
      .select('idx, storage_path, duration_ms')
      .eq('recording_id', recordingId)
      .order('idx');
    if (error) throw error;
    if (!segments?.length) throw new Error('No audio was uploaded for this recording');

    // 1. Transcribe each segment and place it on the recording's timeline.
    let offset = 0;
    let language: string | null = null;
    const all: Utterance[] = [];
    for (const seg of segments) {
      const { data: signed, error: signErr } = await admin.storage.from('audio').createSignedUrl(seg.storage_path, 60 * 60);
      if (signErr || !signed) throw new Error(`Could not read audio segment ${seg.idx}`);
      const result = await transcribe(signed.signedUrl);
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

    // 2. Structured notes from Claude.
    const notes = await claudeStructured<NotesOutput>(
      systemPrompt(template),
      [{ role: 'user', content: `Transcript:\n\n${formatTranscript(all)}` }],
      NOTES_TOOL,
    );

    // 3. Check every task and decision against the transcript before saving.
    const tasks = verifyActionItems(notes.action_items ?? [], all);
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
      model: Deno.env.get('CLAUDE_MODEL') ?? 'claude-sonnet-5-5',
    });

    // Reprocessing replaces this recording's AI tasks.
    await admin.from('tasks').delete().eq('recording_id', recordingId);
    if (tasks.length) {
      await admin.from('tasks').insert(tasks.map((t) => ({ ...t, recording_id: recordingId, user_id: userId })));
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
