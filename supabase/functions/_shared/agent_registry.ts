// The typed tool registry for the agent. Mirrors the MCP tool pattern
// (_shared/mcp.ts TOOLS[]) and reads through the same permission-aware Source, but is
// owned by the agent runtime. Phase 1 registers read-only tools only; mutation tools
// are added in Phase 4 once idempotency and approval gating exist.
import type { AgentTool } from './agent_types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, max = 500): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

function num(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(lo, Math.min(hi, n));
}

function needId(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new Error(`${field} must be an id returned by another tool`);
  return v;
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'projects.list',
    description: 'List the projects the user can see.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    permissionScope: 'projects',
    riskLevel: 'read',
    requiresApproval: false,
    run: async (_args, ctx) => ctx.source.listProjects(),
  },
  {
    name: 'recordings.list',
    description: 'List recent recordings, newest first; filter by project or date.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false },
    permissionScope: 'recordings',
    riskLevel: 'read',
    requiresApproval: false,
    run: async (args, ctx) =>
      ctx.source.listRecordings({
        project_id: args.project_id ? needId(args.project_id, 'project_id') : undefined,
        limit: num(args.limit, 20, 1, 50),
      }),
  },
  {
    name: 'recordings.search',
    description: 'Full-text search across transcripts; returns matching recordings with a snippet and timestamp.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'], additionalProperties: false },
    permissionScope: 'recordings',
    riskLevel: 'read',
    requiresApproval: false,
    run: async (args, ctx) => {
      const q = str(args.query, 200)?.trim();
      if (!q) throw new Error('query is required');
      return ctx.source.searchRecordings(q, num(args.limit, 8, 1, 20));
    },
  },
  {
    name: 'notes.retrieve',
    description: 'Get the overview, key points, verified decisions and action items for one recording.',
    inputSchema: { type: 'object', properties: { recording_id: { type: 'string' } }, required: ['recording_id'], additionalProperties: false },
    permissionScope: 'recordings',
    riskLevel: 'read',
    requiresApproval: false,
    run: async (args, ctx) => {
      const out = await ctx.source.getNotes(needId(args.recording_id, 'recording_id'));
      if (!out) throw new Error('Not found, or you do not have access to it');
      return out;
    },
  },
  {
    name: 'transcripts.retrieve',
    description: 'Get one recording transcript with timestamps and speakers, in pages.',
    inputSchema: {
      type: 'object',
      properties: { recording_id: { type: 'string' }, offset: { type: 'number' }, max_chars: { type: 'number' } },
      required: ['recording_id'],
      additionalProperties: false,
    },
    permissionScope: 'recordings',
    riskLevel: 'read',
    requiresApproval: false,
    run: async (args, ctx) => {
      const out = await ctx.source.getTranscript(
        needId(args.recording_id, 'recording_id'),
        num(args.offset, 0, 0, 10_000_000),
        num(args.max_chars, 15000, 1000, 40000),
      );
      if (!out) throw new Error('Not found, or you do not have access to it');
      return out;
    },
  },
  {
    name: 'tasks.list',
    description: 'List action items across accessible recordings. status "open" = confirmed, "review" = the AI was unsure, "done" = completed.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'review', 'done'] }, project_id: { type: 'string' }, limit: { type: 'number' } },
      additionalProperties: false,
    },
    permissionScope: 'tasks',
    riskLevel: 'read',
    requiresApproval: false,
    run: async (args, ctx) => {
      const status = typeof args.status === 'string' && ['open', 'review', 'done'].includes(args.status) ? (args.status as 'open' | 'review' | 'done') : 'open';
      return ctx.source.listTasks({
        status,
        project_id: args.project_id ? needId(args.project_id, 'project_id') : undefined,
        limit: num(args.limit, 50, 1, 100),
      });
    },
  },
];

const byName = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function resolveTool(name: string): AgentTool | undefined {
  return byName.get(name);
}

export function toolNames(): string[] {
  return AGENT_TOOLS.map((t) => t.name);
}
