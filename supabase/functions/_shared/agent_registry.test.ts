import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_TOOLS, resolveTool, toolNames } from './agent_registry.ts';
import type { Source, RecordingInfo, TaskInfo } from './mcp.ts';

const RID = '10000000-0000-0000-0000-000000000001';
const src: Source = {
  listProjects: async () => [{ id: 'p1', name: 'Riverside', team: 'Acme' }],
  listRecordings: async () => [{ id: RID, title: 'Site walk', date: '2026-10-15', project: null, status: 'ready', minutes: 12 } as RecordingInfo],
  searchRecordings: async (q) => [{ id: RID, title: 'Site walk', date: '2026-10-15', project: null, status: 'ready', minutes: 12, snippet: `hit:${q}`, at_ms: 5000 }],
  getNotes: async (id) => (id === RID ? { overview: 'ok' } : null),
  getTranscript: async (_id, _o, maxChars) => ({ text: '[0:00] Speaker 1: hi', next_offset: null }),
  listTasks: async (o) => [{ id: 't1', text: 'do it', owner: null, due: null, status: o.status, needs_review: false, recording: null, recording_id: RID, quote: null } as TaskInfo],
  setTaskStatus: async () => false,
  searchKnowledge: async (q, limit) =>
    [{ id: 'a1', subject: 'Maya', predicate: 'works_on', object: 'Riverside', value: null, confidence: 0.9, source_refs: [{ recordingId: RID, startMs: 0, excerpt: 'x', verificationStatus: 'verified' }] }]
      .filter((k) => k.predicate.includes(q))
      .slice(0, limit),
  listDecisionHistory: async () => [{ id: 'd1', text: 'Use Hilti', status: 'accepted', recording_id: RID, project_id: null, supersedes_id: null, created_at: '2026-11-15T00:00:00Z' }],
};
const ctx = { userId: '00000000-0000-0000-0000-0000000000a1', source: src };

test('registry exposes the eight read-only tools (Phase 1 + KG memory)', () => {
  assert.deepEqual(
    toolNames().sort(),
    ['knowledge.decision_history', 'knowledge.search', 'notes.retrieve', 'projects.list', 'recordings.list', 'recordings.search', 'tasks.list', 'transcripts.retrieve'].sort(),
  );
});

test('every registered tool is read-only and requires no approval', () => {
  for (const t of AGENT_TOOLS) {
    assert.equal(t.riskLevel, 'read');
    assert.equal(t.requiresApproval, false);
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
