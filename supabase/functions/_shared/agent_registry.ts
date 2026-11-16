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
  {
    name: 'knowledge.search',
    description: 'Search verified knowledge-graph facts (entities + assertions with source evidence).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'], additionalProperties: false },
    permissionScope: 'knowledge',
    riskLevel: 'read',
    requiresApproval: false,
    run: async (args, ctx) => {
      const q = str(args.query, 200)?.trim();
      if (!q) throw new Error('query is required');
      return ctx.source.searchKnowledge ? ctx.source.searchKnowledge(q, num(args.limit, 20, 1, 100)) : [];
    },
  },
  {
    name: 'knowledge.decision_history',
    description: 'List recorded decisions in order (accepted and superseded) for chronological conflict review.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false },
    permissionScope: 'knowledge',
    riskLevel: 'read',
    requiresApproval: false,
    run: async (args, ctx) =>
      ctx.source.listDecisionHistory
        ? ctx.source.listDecisionHistory({
            project_id: args.project_id ? needId(args.project_id, 'project_id') : undefined,
            limit: num(args.limit, 50, 1, 200),
          })
        : [],
  },
  {
    name: 'tasks.update',
    description: 'Mark one action item done, or reopen it.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, status: { type: 'string', enum: ['done', 'open'] } },
      required: ['task_id', 'status'],
      additionalProperties: false,
    },
    permissionScope: 'tasks',
    riskLevel: 'write',
    requiresApproval: true,
    run: async (args, ctx) => {
      if (args.status !== 'done' && args.status !== 'open') throw new Error('status must be "done" or "open"');
      const ok = await ctx.source.setTaskStatus(needId(args.task_id, 'task_id'), args.status);
      if (!ok) throw new Error('Not found, or you do not have access');
      return { task_id: args.task_id, status: args.status };
    },
  },
  {
    name: 'tasks.create',
    description: 'Create an action item from a commitment, grounded by a verbatim quote from that recording.',
    inputSchema: {
      type: 'object',
      properties: {
        recording_id: { type: 'string' },
        text: { type: 'string' },
        owner: { type: 'string' },
        due_text: { type: 'string' },
        quote: { type: 'string' },
      },
      required: ['recording_id', 'text', 'quote'],
      additionalProperties: false,
    },
    permissionScope: 'tasks',
    riskLevel: 'write',
    requiresApproval: true,
    run: async (args, ctx) => {
      if (!ctx.source.createTask) throw new Error('task creation is not available');
      return ctx.source.createTask({
        recording_id: needId(args.recording_id, 'recording_id'),
        text: str(args.text, 1000) ?? '',
        owner: args.owner ? str(args.owner, 200) ?? null : null,
        due_text: args.due_text ? str(args.due_text, 200) ?? null : null,
        quote: str(args.quote, 1000) ?? '',
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
