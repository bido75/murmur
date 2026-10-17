// Token authentication and the readable-data source shared by the MCP server and the REST API.
// The service client is used, so every query is explicitly limited to what the token's user
// could see in the app: their own recordings plus those in projects of teams they belong to.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { RecordingInfo, Source, TaskInfo } from './mcp.ts';
import { formatTranscript, type Utterance } from './verify.ts';

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Two kinds of token:
 * - personal API tokens (mur_...) made in the app's settings, for header-based clients
 * - OAuth access tokens (mat_...) from the sign-in flow, which must have been issued for
 *   this exact MCP URL (audience check) and not be expired
 */
export async function authenticate(db: SupabaseClient, token: string, mcp: string): Promise<string | null> {
  const hash = await sha256(token);
  if (token.startsWith('mur_')) {
    const { data } = await db.from('api_tokens').select('id, user_id').eq('token_hash', hash).maybeSingle();
    if (!data) return null;
    void db.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
    return data.user_id;
  }
  if (token.startsWith('mat_')) {
    const { data } = await db
      .from('oauth_tokens')
      .select('user_id, resource, expires_at')
      .eq('token_hash', hash)
      .eq('kind', 'access')
      .maybeSingle();
    if (!data || new Date(data.expires_at).getTime() <= Date.now() || data.resource !== mcp) return null;
    return data.user_id;
  }
  return null;
}

/** Everything the user can read, decided by the same SQL rules the app uses (no cap on history). */
export async function makeSource(db: SupabaseClient, uid: string): Promise<Source> {
  type ProjectRow = { id: string; name: string; workspace_id: string | null; team: string | null };
  type RecRow = { id: string; user_id: string; project_id: string | null; title: string; created_at: string; status: string; duration_ms: number };
  const { data: projects } = await db.rpc('readable_projects', { uid });
  const projectList = (projects ?? []) as ProjectRow[];
  const projectName = new Map(projectList.map((p) => [p.id, p.name]));

  const info = (r: RecRow): RecordingInfo => ({
    id: r.id,
    title: r.title,
    date: String(r.created_at).slice(0, 10),
    project: r.project_id ? projectName.get(r.project_id) ?? null : null,
    status: r.status,
    minutes: Math.round((r.duration_ms ?? 0) / 60000),
  });
  const readableRec = async (id: string): Promise<RecRow | null> => {
    const { data: ok } = await db.rpc('can_read_recording', { rid: id, uid });
    if (!ok) return null;
    const { data } = await db.from('recordings').select('id, user_id, project_id, title, created_at, status, duration_ms').eq('id', id).maybeSingle();
    return (data as RecRow | null) ?? null;
  };

  return {
    async listProjects() {
      return projectList.map((p) => ({ id: p.id, name: p.name, team: p.team }));
    },

    async listRecordings({ project_id, since, limit, before }) {
      const { data } = await db.rpc('readable_recording_page', { uid, pid: project_id ?? null, since: since ?? null, before: before ?? null, max_rows: limit });
      return ((data ?? []) as RecRow[]).map(info);
    },

    async searchRecordings(query, limit) {
      const { data } = await db.rpc('search_recordings_for', { uid, q: query, max_results: limit });
      return ((data ?? []) as (RecRow & { recording_id: string; snippet: string | null; at_ms: number | null })[]).map((h) => ({
        ...info({ ...h, id: h.recording_id }),
        snippet: h.snippet ?? '',
        at_ms: h.at_ms,
      }));
    },

    async getNotes(recordingId) {
      const r = await readableRec(recordingId);
      if (!r) return null;
      const [{ data: s }, { data: tasks }] = await Promise.all([
        db.from('summaries').select('overview, key_points, decisions, open_questions, task_updates, site_log').eq('recording_id', recordingId).maybeSingle(),
        db.from('tasks').select('id, text, owner, due_text, status, needs_review, quote').eq('recording_id', recordingId).neq('status', 'dismissed'),
      ]);
      return { recording: info(r), ...(s ?? { overview: 'Notes are not ready yet.' }), action_items: tasks ?? [] };
    },

    async getTranscript(recordingId, offset, maxChars) {
      if (!(await readableRec(recordingId))) return null;
      const { data } = await db.from('transcripts').select('utterances, speaker_names').eq('recording_id', recordingId).maybeSingle();
      if (!data) return { text: '', next_offset: null };
      const full = formatTranscript((data.utterances ?? []) as Utterance[], data.speaker_names ?? {});
      const end = Math.min(full.length, offset + maxChars);
      return { text: full.slice(offset, end), next_offset: end < full.length ? end : null };
    },

    async listTasks({ status, project_id, limit }) {
      const { data } = await db.rpc('readable_tasks', { uid, task_status: status, pid: project_id ?? null, max_rows: limit });
      return ((data ?? []) as { id: string; text: string; owner: string | null; due_text: string | null; status: string; needs_review: boolean; recording_id: string; recording: string; quote: string | null }[]).map(
        (t): TaskInfo => ({
          id: t.id,
          text: t.text,
          owner: t.owner,
          due: t.due_text,
          status: t.status,
          needs_review: t.needs_review,
          recording_id: t.recording_id,
          recording: t.recording,
          quote: t.quote,
        }),
      );
    },

    async createWebhook(url, events) {
      const { data, error } = await db.from('webhooks').insert({ user_id: uid, url, events }).select('id').single();
      return error ? null : { id: data.id as string };
    },

    async deleteWebhook(id) {
      const { data } = await db.from('webhooks').delete().eq('id', id).eq('user_id', uid).select('id');
      return (data ?? []).length > 0;
    },

    async setTaskStatus(taskId, status) {
      const { data: t } = await db.from('tasks').select('id, recording_id, user_id').eq('id', taskId).maybeSingle();
      if (!t) return false;
      const allowed = t.user_id === uid || (t.recording_id && (await readableRec(t.recording_id)) !== null);
      if (!allowed) return false;
      const { error } = await db.from('tasks').update({ status }).eq('id', taskId);
      return !error;
    },
  };
}
