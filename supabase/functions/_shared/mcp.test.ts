import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, TOOLS, type Source } from './mcp.ts';

const RID = '10000000-0000-0000-0000-000000000001';
const TID = '20000000-0000-0000-0000-000000000001';
const calls: string[] = [];
const src: Source = {
  listProjects: async () => [{ id: 'p', name: 'Riverside', team: 'Acme' }],
  listRecordings: async (o) => (calls.push(`list:${o.limit}`), []),
  searchRecordings: async (q) => (calls.push(`search:${q}`), [{ id: RID, title: 'Site walk', date: '2026-10-15', project: null, status: 'ready', minutes: 12, snippet: 'crane' }]),
  getNotes: async (id) => (id === RID ? { overview: 'ok' } : null),
  getTranscript: async () => ({ text: '[0:00] Speaker 1: hi', next_offset: null }),
  listTasks: async (o) => (calls.push(`tasks:${o.status}`), []),
  setTaskStatus: async (id) => id === TID,
};
const call = (method: string, params?: object, id: number | undefined = 1) => handle({ jsonrpc: '2.0', id, method, params: params as never }, src, 'Murmur');

test('initialize negotiates a supported protocol version', async () => {
  const r = await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal((r!.result as { protocolVersion: string }).protocolVersion, '2025-03-26');
  const r2 = await call('initialize', { protocolVersion: '1999-01-01' });
  assert.equal((r2!.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
});

test('notifications get no reply', async () => {
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, src, 'Murmur'), null);
});

test('tools/list exposes every tool with a schema and read-only hints', async () => {
  const r = await call('tools/list');
  const tools = (r!.result as { tools: { name: string; inputSchema: object; annotations: { readOnlyHint: boolean } }[] }).tools;
  assert.equal(tools.length, TOOLS.length);
  assert.equal(tools.find((t) => t.name === 'set_task_status')!.annotations.readOnlyHint, false);
  assert.ok(tools.every((t) => t.inputSchema));
});

test('tools/call returns JSON text content', async () => {
  const r = await call('tools/call', { name: 'search_recordings', arguments: { query: 'crane' } });
  const res = r!.result as { content: { text: string }[]; isError: boolean };
  assert.equal(res.isError, false);
  assert.equal(JSON.parse(res.content[0].text)[0].id, RID);
});

test('bad input and missing records are tool errors, not crashes', async () => {
  const bad = await call('tools/call', { name: 'get_recording_notes', arguments: { recording_id: 'not-an-id' } });
  assert.equal((bad!.result as { isError: boolean }).isError, true);
  const missing = await call('tools/call', { name: 'get_recording_notes', arguments: { recording_id: '10000000-0000-0000-0000-00000000ffff' } });
  assert.match((missing!.result as { content: { text: string }[] }).content[0].text, /Not found/);
  const empty = await call('tools/call', { name: 'search_recordings', arguments: { query: '  ' } });
  assert.equal((empty!.result as { isError: boolean }).isError, true);
});

test('limits are clamped and status defaults to open', async () => {
  calls.length = 0;
  await call('tools/call', { name: 'list_recordings', arguments: { limit: 9999 } });
  await call('tools/call', { name: 'list_tasks', arguments: { status: 'weird' } });
  assert.deepEqual(calls, ['list:50', 'tasks:open']);
});

test('unknown method and unknown tool are JSON-RPC errors', async () => {
  assert.equal((await call('resources/list'))!.error!.code, -32601);
  assert.equal((await call('tools/call', { name: 'drop_tables' }))!.error!.code, -32602);
});

test('set_task_status only accepts done/open', async () => {
  const r = await call('tools/call', { name: 'set_task_status', arguments: { task_id: TID, status: 'dismissed' } });
  assert.equal((r!.result as { isError: boolean }).isError, true);
  const ok = await call('tools/call', { name: 'set_task_status', arguments: { task_id: TID, status: 'done' } });
  assert.equal((ok!.result as { isError: boolean }).isError, false);
});
