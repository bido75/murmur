// POST { recording_id, destination, emails? } → sends the notes to a connected tool.
// destination: slack | notion | google_docs | onenote | hubspot | salesforce
// Anyone who can read the recording can send it to their own connected tools.
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { loadNotes, recordingLink } from '../_shared/notes_data.ts';
import { sendTo, type Destination } from '../_shared/after_ready.ts';

const DESTINATIONS: Destination[] = ['slack', 'notion', 'google_docs', 'onenote', 'hubspot', 'salesforce'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { id: userId, client } = await requireUser(req);
    const { recording_id, destination, emails, lang } = await req.json();
    if (!DESTINATIONS.includes(destination)) throw new HttpError(400, 'Unknown destination');
    const loaded = await loadNotes(client, recording_id); // RLS: must be readable by the caller
    if (!loaded) throw new HttpError(404, 'Recording not found');
    if (loaded.rec.status !== 'ready') throw new HttpError(400, 'Wait until the notes are ready.');

    // When a translation language is provided, overlay the cached translation
    // onto the notes so the export contains the translated content.
    if (lang && typeof lang === 'string') {
      const { data: tr } = await client.from('translations').select('summary, tasks').eq('recording_id', recording_id).eq('lang', lang).maybeSingle();
      if (tr?.summary) {
        const s = tr.summary as { overview?: string; key_points?: string[]; decisions?: { text: string }[]; open_questions?: string[] };
        const taskMap = (tr.tasks ?? {}) as Record<string, string>;
        loaded.notes.overview = s.overview ?? loaded.notes.overview;
        if (s.key_points) loaded.notes.key_points = s.key_points.map((text: string, i: number) => ({
          text,
          verified: loaded.notes.key_points[i]?.verified ?? true,
        }));
        if (s.decisions) loaded.notes.decisions = s.decisions.map((d: { text: string }, i: number) => ({
          text: d.text,
          quote: loaded.notes.decisions[i]?.quote ?? null,
        }));
        if (s.open_questions) loaded.notes.open_questions = s.open_questions;
        // Overlay task texts by matching against the original task order
        const taskTexts = Object.values(taskMap);
        if (taskTexts.length) {
          const original = loaded.notes.tasks;
          loaded.notes.tasks = original.map((t, i) => ({
            ...t,
            text: taskTexts[i] ?? t.text,
          }));
        }
        // Mark the language in the title so the destination shows which version was sent
        loaded.notes.title = `${loaded.notes.title} (${lang})`;
      }
    }

    const list = Array.isArray(emails) ? emails.map(String).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 10) : [];
    const result = await sendTo(userId, destination, loaded, recordingLink(recording_id), list);
    // Remember where it went (shown on the recording).
    const admin = adminClient();
    const { data: s } = await admin.from('summaries').select('exports').eq('recording_id', recording_id).maybeSingle();
    await admin.from('summaries').update({ exports: { ...((s?.exports as Record<string, unknown>) ?? {}), [destination]: { ...result, at: new Date().toISOString() } } }).eq('recording_id', recording_id);
    return json(result);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('export failed', e);
    return json({ error: (e as Error).message }, status);
  }
});
