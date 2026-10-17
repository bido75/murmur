// Public REST API: `Authorization: Bearer mur_...` (a personal API token from the app).
// Deploy with --no-verify-jwt. Same data and permissions as the MCP server.
//   GET   /api/v1/projects
//   GET   /api/v1/recordings?project_id=&since=&limit=
//   GET   /api/v1/recordings/{id}            notes, decisions, action items
//   GET   /api/v1/recordings/{id}/transcript?offset=
//   GET   /api/v1/search?q=
//   GET   /api/v1/tasks?status=open|review|done&project_id=
//   PATCH /api/v1/tasks/{id}   { "status": "done" | "open" }
import { adminClient } from '../_shared/services.ts';
import { authenticate, makeSource } from '../_shared/mcp_source.ts';
import { route } from '../_shared/rest.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS' };
const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token.startsWith('mur_')) return send(401, { error: 'Use a personal API token: Authorization: Bearer mur_…' });
  const db = adminClient();
  const userId = await authenticate(db, token, '');
  if (!userId) return send(401, { error: 'Invalid or revoked token' });
  let body: unknown = null;
  if (req.method === 'PATCH') body = await req.json().catch(() => null);
  try {
    const u = new URL(req.url);
    const r = await route({ method: req.method, path: u.pathname, query: u.searchParams, body }, await makeSource(db, userId));
    return send(r.status, r.body);
  } catch (e) {
    console.error('api error', e);
    return send(500, { error: 'Something went wrong' });
  }
});
