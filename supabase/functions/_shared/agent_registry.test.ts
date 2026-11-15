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
};
const ctx = { userId: '00000000-0000-0000-0000-0000000000a1', source: src };

test('registry exposes the six Phase 1 read-only tools', () => {
  assert.deepEqual(toolNames().sort(), ['notes.retrieve', 'projects.list', 'recordings.list', 'recordings.search', 'tasks.list', 'transcripts.retrieve'].sort());
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
