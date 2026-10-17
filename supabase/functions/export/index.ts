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
    const { recording_id, destination, emails } = await req.json();
    if (!DESTINATIONS.includes(destination)) throw new HttpError(400, 'Unknown destination');
    const loaded = await loadNotes(client, recording_id); // RLS: must be readable by the caller
    if (!loaded) throw new HttpError(404, 'Recording not found');
    if (loaded.rec.status !== 'ready') throw new HttpError(400, 'Wait until the notes are ready.');
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
