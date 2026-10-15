// Model Context Protocol server logic (JSON-RPC 2.0 over Streamable HTTP, JSON responses).
// Pure: the data comes from a `Source`, so this file is unit-tested without a database.

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export type RecordingInfo = { id: string; title: string; date: string; project: string | null; status: string; minutes: number };
export type TaskInfo = { id: string; text: string; owner: string | null; due: string | null; status: string; needs_review: boolean; recording: string | null; recording_id: string | null; quote: string | null };

export interface Source {
  listProjects(): Promise<{ id: string; name: string; team: string | null }[]>;
  listRecordings(opts: { project_id?: string; since?: string; limit: number }): Promise<RecordingInfo[]>;
  searchRecordings(query: string, limit: number): Promise<(RecordingInfo & { snippet: string })[]>;
  getNotes(recordingId: string): Promise<Record<string, unknown> | null>;
  getTranscript(recordingId: string, offset: number, maxChars: number): Promise<{ text: string; next_offset: number | null } | null>;
  listTasks(opts: { status: 'open' | 'review' | 'done'; project_id?: string; limit: number }): Promise<TaskInfo[]>;
  setTaskStatus(taskId: string, status: 'open' | 'done'): Promise<boolean>;
}

type Json = Record<string, unknown>;
type Tool = { name: string; title: string; description: string; inputSchema: Json; readOnly: boolean; run: (args: Json, src: Source) => Promise<unknown> };

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown, def: number, lo: number, hi: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ToolInputError extends Error {}
function needId(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new ToolInputError(`${field} must be an id returned by another tool`);
  return v;
}

export const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'List the projects (clients, job sites, teams) the user can see.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    run: (_a, src) => src.listProjects(),
  },
  {
    name: 'list_recordings',
    title: 'List recordings',
    description: 'List recent recordings, newest first. Optionally filter by project or start date.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project id from list_projects.' },
        since: { type: 'string', description: 'ISO date, e.g. 2026-10-01.' },
        limit: { type: 'number', description: '1–50, default 20.' },
      },
      additionalProperties: false,
    },
    readOnly: true,
    run: (a, src) =>
      src.listRecordings({
        project_id: a.project_id ? needId(a.project_id, 'project_id') : undefined,
        since: str(a.since, 40),
        limit: num(a.limit, 20, 1, 50),
      }),
  },
  {
    name: 'search_recordings',
    title: 'Search recordings',
    description: 'Full-text search across transcripts. Returns matching recordings with a snippet.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to look for.' }, limit: { type: 'number', description: '1–20, default 8.' } },
      required: ['query'],
      additionalProperties: false,
    },
    readOnly: true,
    run: (a, src) => {
      const q = str(a.query, 200)?.trim();
      if (!q) throw new ToolInputError('query is required');
      return src.searchRecordings(q, num(a.limit, 8, 1, 20));
    },
  },
  {
    name: 'get_recording_notes',
    title: 'Get notes',
    description: 'Get the summary, key points, decisions (with quotes), open questions and action items for one recording.',
    inputSchema: { type: 'object', properties: { recording_id: { type: 'string' } }, required: ['recording_id'], additionalProperties: false },
    readOnly: true,
    run: async (a, src) => (await src.getNotes(needId(a.recording_id, 'recording_id'))) ?? notFound(),
  },
  {
    name: 'get_transcript',
    title: 'Get transcript',
    description: 'Get a recording transcript with timestamps and speakers, in pages. Pass next_offset to continue.',
    inputSchema: {
      type: 'object',
      properties: {
        recording_id: { type: 'string' },
        offset: { type: 'number', description: 'Character offset, default 0.' },
        max_chars: { type: 'number', description: '1000–40000, default 15000.' },
      },
      required: ['recording_id'],
      additionalProperties: false,
    },
    readOnly: true,
    run: async (a, src) =>
      (await src.getTranscript(needId(a.recording_id, 'recording_id'), num(a.offset, 0, 0, 10_000_000), num(a.max_chars, 15000, 1000, 40000))) ?? notFound(),
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: 'List action items. status "open" = confirmed and not done, "review" = the AI was unsure, "done" = completed.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'review', 'done'] },
        project_id: { type: 'string' },
        limit: { type: 'number', description: '1–100, default 50.' },
      },
      additionalProperties: false,
    },
    readOnly: true,
    run: (a, src) => {
      const status = a.status === 'review' || a.status === 'done' ? a.status : 'open';
      return src.listTasks({ status, project_id: a.project_id ? needId(a.project_id, 'project_id') : undefined, limit: num(a.limit, 50, 1, 100) });
    },
  },
  {
    name: 'set_task_status',
    title: 'Mark task done or open',
    description: 'Mark an action item done, or reopen it.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, status: { type: 'string', enum: ['done', 'open'] } },
      required: ['task_id', 'status'],
      additionalProperties: false,
    },
    readOnly: false,
    run: async (a, src) => {
      if (a.status !== 'done' && a.status !== 'open') throw new ToolInputError('status must be "done" or "open"');
      const ok = await src.setTaskStatus(needId(a.task_id, 'task_id'), a.status);
      return ok ? { ok: true, task_id: a.task_id, status: a.status } : notFound();
    },
  },
];

function notFound(): never {
  throw new ToolInputError('Not found, or you do not have access to it.');
}

export type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };
export type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: RpcRequest['id'], result: unknown): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, result });
const err = (id: RpcRequest['id'], code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Handle one JSON-RPC message. Returns null for notifications (no reply). */
export async function handle(msg: RpcRequest, src: Source, serverName: string): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return err(msg?.id ?? null, -32600, 'Invalid request');
  const isNotification = msg.id === undefined;
  if (isNotification) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '');
      return ok(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: serverName, version: '1.0.0' },
        instructions: `Search and read the user's ${serverName} recordings, notes and action items. Quotes are verbatim from transcripts.`,
      });
    }
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const name = msg.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(msg.id, -32602, `Unknown tool: ${String(name)}`);
      const args = (msg.params?.arguments ?? {}) as Json;
      try {
        const data = await tool.run(args, src);
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }], isError: false });
      } catch (e) {
        const message = e instanceof ToolInputError ? e.message : 'Something went wrong on the server.';
        return ok(msg.id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
