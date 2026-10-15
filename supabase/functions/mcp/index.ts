// MCP endpoint: POST JSON-RPC with `Authorization: Bearer mur_...` (a personal API token).
// Deploy with --no-verify-jwt: the token is ours, not a Supabase session.
//
// Access: the service client is used, so every query here is explicitly limited to what
// the token's user could see in the app: their own recordings plus those in projects of
// teams they belong to.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { handle, type RecordingInfo, type RpcRequest, type Source, type TaskInfo } from '../_shared/mcp.ts';
import { adminClient } from '../_shared/services.ts';
import { formatTranscript, type Utterance } from '../_shared/verify.ts';

const SERVER_NAME = Deno.env.get('APP_NAME') ?? 'Murmur';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function reply(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, ...(body === null ? {} : { 'Content-Type': 'application/json' }), ...extra },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // Streamable HTTP: we don't offer a server-to-client event stream.
  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405, { Allow: 'POST' });

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token.startsWith('mur_')) {
    return reply({ error: 'Missing or invalid API token' }, 401, { 'WWW-Authenticate': 'Bearer' });
  }
  const db = adminClient();
  const { data: tok } = await db.from('api_tokens').select('id, user_id').eq('token_hash', await sha256(token)).maybeSingle();
  if (!tok) return reply({ error: 'Invalid or revoked API token' }, 401, { 'WWW-Authenticate': 'Bearer' });
  void db.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id);

  let body: RpcRequest | RpcRequest[];
  try {
    body = await req.json();
  } catch {
    return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const src = await makeSource(db, tok.user_id);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, src, SERVER_NAME)))).filter(Boolean);
    return out.length ? reply(out) : reply(null, 202);
  }
  const res = await handle(body, src, SERVER_NAME);
  return res ? reply(res) : reply(null, 202);
});

/** Everything the user can read, worked out once per request by the same SQL rules the app uses. */
async function makeSource(db: SupabaseClient, uid: string): Promise<Source> {
  type ProjectRow = { id: string; name: string; workspace_id: string | null; team: string | null };
  type RecRow = { id: string; user_id: string; project_id: string | null; title: string; created_at: string; status: string; duration_ms: number };
  const [{ data: projects }, { data: recs }] = await Promise.all([
    db.rpc('readable_projects', { uid }),
    db.rpc('readable_recordings', { uid, max_rows: 1000 }),
  ]);
  const projectList = (projects ?? []) as ProjectRow[];
  const projectName = new Map(projectList.map((p) => [p.id, p.name]));
  const readable = (recs ?? []) as RecRow[];
  const recById = new Map(readable.map((r) => [r.id, r]));

  const info = (r: (typeof readable)[number]): RecordingInfo => ({
    id: r.id,
    title: r.title,
    date: String(r.created_at).slice(0, 10),
    project: r.project_id ? projectName.get(r.project_id) ?? null : null,
    status: r.status,
    minutes: Math.round((r.duration_ms ?? 0) / 60000),
  });

  return {
    async listProjects() {
      return projectList.map((p) => ({ id: p.id, name: p.name, team: p.team }));
    },

    async listRecordings({ project_id, since, limit }) {
      return readable
        .filter((r) => (!project_id || r.project_id === project_id) && (!since || String(r.created_at) >= since))
        .slice(0, limit)
        .map(info);
    },

    async searchRecordings(query, limit) {
      const ids = readable.map((r) => r.id);
      if (!ids.length) return [];
      const words = query.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
      if (!words.length) return [];
      const { data } = await db
        .from('transcripts')
        .select('recording_id, text')
        .in('recording_id', ids.slice(0, 500))
        .textSearch('search', words.join(' | '), { config: 'simple' })
        .limit(limit);
      return (data ?? [])
        .filter((t) => recById.has(t.recording_id))
        .map((t) => {
          const lower = String(t.text).toLowerCase();
          const at = Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), lower.length) - 120);
          return { ...info(recById.get(t.recording_id)!), snippet: String(t.text).slice(at, at + 300) };
        });
    },

    async getNotes(recordingId) {
      const r = recById.get(recordingId);
      if (!r) return null;
      const [{ data: s }, { data: tasks }] = await Promise.all([
        db.from('summaries').select('overview, key_points, decisions, open_questions, task_updates').eq('recording_id', recordingId).maybeSingle(),
        db.from('tasks').select('id, text, owner, due_text, status, needs_review, quote').eq('recording_id', recordingId).neq('status', 'dismissed'),
      ]);
      return { recording: info(r), ...(s ?? { overview: 'Notes are not ready yet.' }), action_items: tasks ?? [] };
    },

    async getTranscript(recordingId, offset, maxChars) {
      if (!recById.has(recordingId)) return null;
      const { data } = await db.from('transcripts').select('utterances, speaker_names').eq('recording_id', recordingId).maybeSingle();
      if (!data) return { text: '', next_offset: null };
      const full = formatTranscript((data.utterances ?? []) as Utterance[], data.speaker_names ?? {});
      const end = Math.min(full.length, offset + maxChars);
      return { text: full.slice(offset, end), next_offset: end < full.length ? end : null };
    },

    async listTasks({ status, project_id, limit }) {
      const ids = readable.filter((r) => !project_id || r.project_id === project_id).map((r) => r.id);
      if (!ids.length) return [];
      let q = db
        .from('tasks')
        .select('id, text, owner, due_text, status, needs_review, recording_id, quote')
        .in('recording_id', ids.slice(0, 500))
        .order('created_at', { ascending: false })
        .limit(limit);
      if (status === 'open') q = q.eq('status', 'open').eq('needs_review', false);
      if (status === 'review') q = q.eq('status', 'open').eq('needs_review', true);
      if (status === 'done') q = q.eq('status', 'done');
      const { data } = await q;
      return (data ?? []).map(
        (t): TaskInfo => ({
          id: t.id,
          text: t.text,
          owner: t.owner,
          due: t.due_text,
          status: t.status,
          needs_review: t.needs_review,
          recording_id: t.recording_id,
          recording: t.recording_id ? recById.get(t.recording_id)?.title ?? null : null,
          quote: t.quote,
        }),
      );
    },

    async setTaskStatus(taskId, status) {
      const { data: t } = await db.from('tasks').select('id, recording_id, user_id').eq('id', taskId).maybeSingle();
      if (!t) return false;
      const allowed = t.user_id === uid || (t.recording_id && recById.has(t.recording_id));
      if (!allowed) return false;
      const { error } = await db.from('tasks').update({ status }).eq('id', taskId);
      return !error;
    },
  };
}
