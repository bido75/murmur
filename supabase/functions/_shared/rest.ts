// REST API routing over the same readable-data Source as the MCP server. Pure; tested.
import type { Source } from './mcp.ts';

export type RestRequest = { method: string; path: string; query: URLSearchParams; body: unknown };
export type RestResponse = { status: number; body: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limitOf = (q: URLSearchParams, def = 25, max = 100) => Math.max(1, Math.min(max, Number(q.get('limit')) || def));

export async function route(r: RestRequest, src: Source): Promise<RestResponse> {
  const parts = r.path.replace(/^.*?\/v1\/?/, '').split('/').filter(Boolean);
  const [res, id, sub] = parts;
  const notFound = { status: 404, body: { error: 'Not found' } };

  if (r.method === 'GET' && res === 'projects' && !id) return { status: 200, body: { data: await src.listProjects() } };

  if (r.method === 'GET' && res === 'recordings' && !id) {
    const project_id = r.query.get('project_id') ?? undefined;
    if (project_id && !UUID.test(project_id)) return { status: 400, body: { error: 'project_id must be a UUID' } };
    const since = r.query.get('since') ?? undefined;
    if (since && Number.isNaN(Date.parse(since))) return { status: 400, body: { error: 'since must be a date' } };
    return { status: 200, body: { data: await src.listRecordings({ project_id, since, limit: limitOf(r.query) }) } };
  }
  if (r.method === 'GET' && res === 'recordings' && id && !sub) {
    if (!UUID.test(id)) return notFound;
    const notes = await src.getNotes(id);
    return notes ? { status: 200, body: notes } : notFound;
  }
  if (r.method === 'GET' && res === 'recordings' && id && sub === 'transcript') {
    if (!UUID.test(id)) return notFound;
    const offset = Math.max(0, Number(r.query.get('offset')) || 0);
    const t = await src.getTranscript(id, offset, 50_000);
    return t ? { status: 200, body: t } : notFound;
  }
  if (r.method === 'GET' && res === 'search') {
    const q = (r.query.get('q') ?? '').trim();
    if (q.length < 2) return { status: 400, body: { error: 'q is required' } };
    return { status: 200, body: { data: await src.searchRecordings(q, limitOf(r.query, 10, 25)) } };
  }
  if (r.method === 'GET' && res === 'tasks' && !id) {
    const status = (r.query.get('status') ?? 'open') as 'open' | 'review' | 'done';
    if (!['open', 'review', 'done'].includes(status)) return { status: 400, body: { error: 'status must be open, review or done' } };
    const project_id = r.query.get('project_id') ?? undefined;
    return { status: 200, body: { data: await src.listTasks({ status, project_id, limit: limitOf(r.query, 50, 200) }) } };
  }
  if (r.method === 'PATCH' && res === 'tasks' && id) {
    if (!UUID.test(id)) return notFound;
    const status = (r.body as { status?: string } | null)?.status;
    if (status !== 'open' && status !== 'done') return { status: 400, body: { error: 'status must be open or done' } };
    return (await src.setTaskStatus(id, status)) ? { status: 200, body: { id, status } } : notFound;
  }
  return notFound;
}
