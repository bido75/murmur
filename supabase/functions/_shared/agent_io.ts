// Deno-side action implementations for the agent's external tools (follow-up email and
// export). Lives outside the pure, node-tested registry because it pulls in the export/
// email stack. The endpoint binds these to the authenticated user and injects them as
// `actions`. Deliberately does NOT import after_ready/docx so the agent function's
// dependency graph stays minimal (google_docs export is available via the existing
// `export` function, not through the agent tool).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { loadNotes, recordingLink } from './notes_data.ts';
import { recapEmail } from './share.ts';
import { exportNotion, exportOneNote, logHubspot, logSalesforce, postSlack } from './destinations.ts';
import type { Destination } from './agent_types.ts';

export async function sendFollowup(db: SupabaseClient, uid: string, input: { recording_id: string; to: string[] }): Promise<{ subject: string; recipients: number }> {
  const { data: r } = await db.from('recordings').select('user_id').eq('id', input.recording_id).maybeSingle();
  if (!r) throw new Error('Recording not found');
  if (r.user_id !== uid) throw new Error('Only the recording owner can send its follow-up');

  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RECAP_FROM');
  if (!key || !from) throw new Error('Email is not set up');

  const loaded = await loadNotes(db, input.recording_id);
  if (!loaded) throw new Error('No notes to send yet');

  const { data: u } = await db.auth.admin.getUserById(uid);
  const sender = u.user?.email ?? 'A colleague';
  const to = (input.to ?? []).filter((e) => typeof e === 'string' && /^\S+@\S+\.\S+$/.test(e)).slice(0, 20);
  const e = recapEmail(loaded.notes, { appName: Deno.env.get('APP_NAME') ?? 'Murmur', sender, link: recordingLink(input.recording_id), dateLabel: loaded.rec.created_at.slice(0, 10) });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [sender], bcc: to, reply_to: u.user?.email, subject: e.subject, html: e.html, text: e.text }),
  });
  if (!res.ok) throw new Error(`email ${res.status}`);
  await db.from('recap_emails').insert({ recording_id: input.recording_id, sent_by: uid, recipients: to });
  return { subject: e.subject, recipients: to.length };
}

export async function exportNotes(db: SupabaseClient, uid: string, recordingId: string, destination: Destination): Promise<{ destination: string; url: string | null }> {
  const { data: r } = await db.from('recordings').select('user_id').eq('id', recordingId).maybeSingle();
  if (!r) throw new Error('Recording not found');
  if (r.user_id !== uid) throw new Error('Only the recording owner can export its notes');

  const loaded = await loadNotes(db, recordingId);
  if (!loaded) throw new Error('No notes to export yet');
  const link = recordingLink(recordingId);
  const n = loaded.notes;

  switch (destination) {
    case 'slack':
      await postSlack(uid, n, link);
      return { destination, url: null };
    case 'notion': {
      const out = await exportNotion(uid, n, link);
      return { destination, url: out.url };
    }
    case 'onenote': {
      const out = await exportOneNote(uid, n, link);
      return { destination, url: out.url };
    }
    case 'hubspot':
      await logHubspot(uid, n, link, []);
      return { destination, url: null };
    case 'salesforce': {
      const out = await logSalesforce(uid, n, link, []);
      return { destination, url: out.url };
    }
    default:
      throw new Error(`Unsupported destination: ${destination}`);
  }
}
