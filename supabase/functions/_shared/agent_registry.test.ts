import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_TOOLS, resolveTool, toolNames } from './agent_registry.ts';
import type { Source, RecordingInfo, TaskInfo } from './mcp.ts';

const RID = '10000000-0000-0000-0000-000000000001';
const TID = '20000000-0000-0000-0000-000000000001';
const src: Source = {
  listProjects: async () => [{ id: 'p1', name: 'Riverside', team: 'Acme' }],
  listRecordings: async () => [{ id: RID, title: 'Site walk', date: '2026-10-15', project: null, status: 'ready', minutes: 12 } as RecordingInfo],
  searchRecordings: async (q) => [{ id: RID, title: 'Site walk', date: '2026-10-15', project: null, status: 'ready', minutes: 12, snippet: `hit:${q}`, at_ms: 5000 }],
  getNotes: async (id) => (id === RID ? { overview: 'ok' } : null),
  getTranscript: async (_id, _o, maxChars) => ({ text: '[0:00] Speaker 1: hi', next_offset: null }),
  listTasks: async (o) => [{ id: 't1', text: 'do it', owner: null, due: null, status: o.status, needs_review: false, recording: null, recording_id: RID, quote: null } as TaskInfo],
  setTaskStatus: async (id) => id === TID,
  searchKnowledge: async (q, limit) =>
    [{ id: 'a1', subject: 'Maya', predicate: 'works_on', object: 'Riverside', value: null, confidence: 0.9, source_refs: [{ recordingId: RID, startMs: 0, excerpt: 'x', verificationStatus: 'verified' }] }]
      .filter((k) => k.predicate.includes(q))
      .slice(0, limit),
  listDecisionHistory: async () => [{ id: 'd1', text: 'Use Hilti', status: 'accepted', recording_id: RID, project_id: null, supersedes_id: null, created_at: '2026-11-15T00:00:00Z' }],
  createTask: async (input) => ({ id: 't-new', text: input.text, owner: input.owner ?? null, owner_basis: input.owner ? 'named' : 'unassigned', due_text: input.due_text ?? null, quote: input.quote, quote_ms: 0, kind: 'commitment', verified: true, needs_review: false }),
};
const ctx = {
  userId: '00000000-0000-0000-0000-0000000000a1',
  source: src,
  actions: {
    sendFollowup: async (input: { recording_id: string; to: string[] }) => ({ subject: 'Recap', recipients: input.to.length }),
    exportNotes: async (_rid: string, destination: string) => ({ destination, url: null }),
    presentationsGenerate: async (args: { recording_id?: string; project_id?: string; kind: string }) => ({ url: null, filename: `${args.kind}.pptx`, slides: 5, embeddedMedia: 0 }),
    documentsGenerate: async (recording_id: string) => ({ url: null, filename: 'notes.docx' }),
  },
};

test('registry exposes eight read, four write, two external tools', () => {
  const reads = AGENT_TOOLS.filter((t) => t.riskLevel === 'read');
  const writes = AGENT_TOOLS.filter((t) => t.riskLevel === 'write');
  const ext = AGENT_TOOLS.filter((t) => t.riskLevel === 'external');
  assert.equal(reads.length, 8);
  assert.deepEqual(writes.map((t) => t.name).sort(), ['documents.generate', 'presentations.generate', 'tasks.create', 'tasks.update']);
  assert.deepEqual(ext.map((t) => t.name).sort(), ['followups.send', 'integrations.export']);
});

test('only read tools run without approval', () => {
  for (const t of AGENT_TOOLS) {
    assert.equal(t.requiresApproval, t.riskLevel !== 'read');
  }
});

test('resolveTool finds a tool and rejects unknown names', () => {
  assert.equal(resolveTool('projects.list')!.name, 'projects.list');
  assert.equal(resolveTool('drop_tables'), undefined);
});

test('projects.list returns scoped projects', async () => {
  const out = await resolveTool('projects.list')!.run({}, ctx) as { name: string }[];
  assert.equal(out[0].name, 'Riverside');
});

test('recordings.search returns a snippet with a timestamp', async () => {
  const out = await resolveTool('recordings.search')!.run({ query: 'crane' }, ctx) as { snippet: string; at_ms: number | null }[];
  assert.equal(out[0].snippet, 'hit:crane');
  assert.equal(out[0].at_ms, 5000);
});

test('notes.retrieve returns null-protected content', async () => {
  const ok = await resolveTool('notes.retrieve')!.run({ recording_id: RID }, ctx) as { overview: string };
  assert.equal(ok.overview, 'ok');
  await assert.rejects(() => resolveTool('notes.retrieve')!.run({ recording_id: '10000000-0000-0000-0000-00000000ffff' }, ctx), /Not found/);
});

test('tasks.list defaults unknown status to open', async () => {
  const out = await resolveTool('tasks.list')!.run({ status: 'weird' }, ctx) as { status: string }[];
  assert.equal(out[0].status, 'open');
});

test('knowledge.search returns verified facts with source refs', async () => {
  const out = await resolveTool('knowledge.search')!.run({ query: 'works_on', limit: 10 }, ctx) as { subject: string; source_refs: unknown[] }[];
  assert.equal(out.length, 1);
  assert.equal(out[0].subject, 'Maya');
  assert.equal(out[0].source_refs.length, 1);
});

test('knowledge.decision_history returns decisions in order', async () => {
  const out = await resolveTool('knowledge.decision_history')!.run({}, ctx) as { id: string; status: string }[];
  assert.equal(out[0].id, 'd1');
  assert.equal(out[0].status, 'accepted');
});

test('tasks.update only accepts done/open and reaches the scoped source', async () => {
  await assert.rejects(() => resolveTool('tasks.update')!.run({ task_id: TID, status: 'dismissed' }, ctx), /done.*open/);
  const ok = await resolveTool('tasks.update')!.run({ task_id: TID, status: 'done' }, ctx) as { status: string };
  assert.equal(ok.status, 'done');
});

test('tasks.create builds a grounded task through the source adapter', async () => {
  const out = await resolveTool('tasks.create')!.run({ recording_id: RID, text: 'Ship', owner: 'Sam', quote: 'ship it' }, ctx) as { owner: string; verified: boolean };
  assert.equal(out.owner, 'Sam');
  assert.equal(out.verified, true);
});

test('followups.send passes recipients through the source adapter', async () => {
  const out = await resolveTool('followups.send')!.run({ recording_id: RID, to: ['a@x.com', 'b@y.com'] }, ctx) as { subject: string; recipients: number };
  assert.equal(out.subject, 'Recap');
  assert.equal(out.recipients, 2);
});

test('integrations.export rejects unknown destinations', async () => {
  await assert.rejects(() => resolveTool('integrations.export')!.run({ recording_id: RID, destination: 'ftp' }, ctx), /unknown destination/);
  const out = await resolveTool('integrations.export')!.run({ recording_id: RID, destination: 'notion' }, ctx) as { destination: string };
  assert.equal(out.destination, 'notion');
});

test('presentations.generate requires a source and a kind', async () => {
  await assert.rejects(() => resolveTool('presentations.generate')!.run({ kind: 'client_update' }, ctx), /recording_id or project_id/);
  await assert.rejects(() => resolveTool('presentations.generate')!.run({ recording_id: RID }, ctx), /kind is required/);
  const out = await resolveTool('presentations.generate')!.run({ recording_id: RID, kind: 'client_update' }, ctx) as { filename: string };
  assert.equal(out.filename, 'client_update.pptx');
});

test('documents.generate builds through the source adapter', async () => {
  const out = await resolveTool('documents.generate')!.run({ recording_id: RID }, ctx) as { filename: string };
  assert.equal(out.filename, 'notes.docx');
});
