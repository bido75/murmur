// Load a recording's shareable notes (confirmed material only) with any Supabase client.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { publicNotes, type PublicNotes } from './share.ts';

export type RecordingRow = { id: string; user_id: string; title: string; created_at: string; duration_ms: number; template: string; status: string; project_id: string | null; consent_method: string };

export async function loadNotes(db: SupabaseClient, recordingId: string): Promise<{ rec: RecordingRow; notes: PublicNotes } | null> {
  const [{ data: rec }, { data: sum }, { data: tasks }] = await Promise.all([
    db.from('recordings').select('id, user_id, title, created_at, duration_ms, template, status, project_id, consent_method').eq('id', recordingId).maybeSingle(),
    db.from('summaries').select('overview, key_points, key_point_details, decisions, open_questions, site_log').eq('recording_id', recordingId).maybeSingle(),
    db.from('tasks').select('text, owner, due_text, status, needs_review').eq('recording_id', recordingId).order('created_at'),
  ]);
  if (!rec) return null;
  return { rec: rec as RecordingRow, notes: publicNotes({ recording: rec, summary: sum, tasks: tasks ?? [] }, false) };
}

export function recordingLink(id: string): string | null {
  const app = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  return app ? `${app}/recording/${id}` : null;
}
