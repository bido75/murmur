import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeUrl,
  createNotesLog,
  createPunchItem,
  listTargets,
  needsRefresh,
  notesLogRequest,
  parseTarget,
  procoreEnv,
  punchItemRequest,
  tokenRequest,
  toTokenSet,
} from './procore.ts';

const env = procoreEnv((k) => ({ PROCORE_CLIENT_ID: 'cid', PROCORE_CLIENT_SECRET: 'sec' })[k]);
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('defaults to production URLs; sandbox is configurable', () => {
  assert.equal(env.loginUrl, 'https://login.procore.com');
  assert.equal(env.apiUrl, 'https://api.procore.com');
  const sb = procoreEnv((k) => ({ PROCORE_LOGIN_URL: 'https://sandbox.procore.com/', PROCORE_API_URL: 'https://sandbox.procore.com' })[k]);
  assert.equal(sb.loginUrl, 'https://sandbox.procore.com');
});

test('authorize URL carries client, redirect and state', () => {
  const u = new URL(authorizeUrl(env, 'https://x.supabase.co/functions/v1/procore/callback', 'ps_abc'));
  assert.equal(u.origin + u.pathname, 'https://login.procore.com/oauth/authorize');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://x.supabase.co/functions/v1/procore/callback');
  assert.equal(u.searchParams.get('state'), 'ps_abc');
});

test('token requests for both grants', () => {
  assert.deepEqual(tokenRequest(env, { code: 'c1', redirectUri: 'r' }), { grant_type: 'authorization_code', client_id: 'cid', client_secret: 'sec', code: 'c1', redirect_uri: 'r' });
  assert.deepEqual(tokenRequest(env, { refreshToken: 'rt' }), { grant_type: 'refresh_token', client_id: 'cid', client_secret: 'sec', refresh_token: 'rt' });
});

test('token expiry and refresh timing', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const t = toTokenSet({ access_token: 'a', refresh_token: 'r', expires_in: 5400, created_at: now / 1000 }, now);
  assert.equal(t.expires_at, '2026-10-15T13:30:00.000Z');
  assert.equal(needsRefresh(t.expires_at, now), false);
  assert.equal(needsRefresh(t.expires_at, now + 5400_000 - 30_000), true, 'refreshes in the last minute');
  assert.equal(needsRefresh(null, now), true);
  assert.equal(needsRefresh('garbage', now), true);
  assert.throws(() => toTokenSet({ access_token: 'a' }), /did not return tokens/);
});

test('targets are company:project ids', () => {
  assert.deepEqual(parseTarget('123:456'), { companyId: '123', projectId: '456' });
  assert.throws(() => parseTarget('456'), /Choose a Procore project/);
  assert.throws(() => parseTarget('1:2/../3'), /Choose a Procore project/);
  assert.throws(() => parseTarget(undefined), /Choose a Procore project/);
});

test('punch item: JSON without photos, multipart with photos', async () => {
  const plain = punchItemRequest('456', { name: '  Fix   guardrail ', description: 'Said: "loose"' });
  assert.equal(plain.json, true);
  assert.deepEqual(JSON.parse(plain.body as string), { project_id: 456, punch_item: { name: 'Fix guardrail', description: 'Said: "loose"' } });

  const multi = punchItemRequest('456', { name: 'Fix guardrail', description: 'd' }, [{ name: 'p.jpg', type: 'image/jpeg', bytes: new Uint8Array([255, 216, 255]) }]);
  assert.equal(multi.json, false);
  const form = multi.body as FormData;
  assert.equal(form.get('project_id'), '456');
  assert.equal(form.get('punch_item[name]'), 'Fix guardrail');
  const file = form.getAll('punch_item[attachments][]')[0] as File;
  assert.equal(file.name, 'p.jpg');
  assert.equal(file.type, 'image/jpeg');
  assert.equal((await file.arrayBuffer()).byteLength, 3);
});

test('daily log note: date checked, long text trimmed', () => {
  assert.deepEqual(JSON.parse(notesLogRequest('2026-10-15', 'hi')), { notes_log: { date: '2026-10-15', comment: 'hi' } });
  assert.throws(() => notesLogRequest('10/15/2026', 'x'));
  const long = JSON.parse(notesLogRequest('2026-10-15', 'x'.repeat(20000))).notes_log.comment;
  assert.ok(long.length <= 9000);
  assert.match(long, /full log in the app/);
});

type Call = { url: string; init: RequestInit };
function stubFetch(responses: unknown[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}
const header = (c: Call, h: string) => (c.init.headers as Record<string, string>)[h];

test('listing projects sends the company header per company', async () => {
  const calls = stubFetch([
    [{ id: 11, name: 'Acme GC' }, { id: 12, name: 'Old Co', is_active: false }],
    [{ id: 501, name: 'Riverside Lofts' }],
  ]);
  const targets = await listTargets(env, 'tok');
  assert.deepEqual(targets, [{ id: '11:501', name: 'Riverside Lofts' }]);
  assert.equal(calls[0].url, 'https://api.procore.com/rest/v1.0/companies');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer tok');
  assert.match(calls[1].url, /\/rest\/v1\.0\/projects\?company_id=11&/);
  assert.equal(header(calls[1], 'Procore-Company-Id'), '11');
});

test('creating a punch item and a daily log note hit the right endpoints', async () => {
  const calls = stubFetch([{ id: 9001 }, { id: 77 }]);
  const item = await createPunchItem(env, 'tok', '11:501', { name: 'Fix guardrail', description: 'd' });
  assert.equal(item.id, '9001');
  assert.equal(item.url, 'https://app.procore.com/501/project/punch_list/form/9001');
  assert.equal(calls[0].url, 'https://api.procore.com/rest/v1.0/punch_items');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(header(calls[0], 'Procore-Company-Id'), '11');
  assert.equal(header(calls[0], 'Content-Type'), 'application/json');

  await createNotesLog(env, 'tok', '11:501', '2026-10-15', 'log');
  assert.equal(calls[1].url, 'https://api.procore.com/rest/v1.0/projects/501/notes_logs');
  assert.deepEqual(JSON.parse(calls[1].init.body as string), { notes_log: { date: '2026-10-15', comment: 'log' } });
});

test('multipart uploads let fetch set the boundary (no JSON content type)', async () => {
  const calls = stubFetch([{ id: 1 }]);
  await createPunchItem(env, 'tok', '11:501', { name: 'x', description: 'd' }, [{ name: 'a.jpg', type: 'image/jpeg', bytes: new Uint8Array([1]) }]);
  assert.equal(header(calls[0], 'Content-Type'), undefined);
  assert.ok(calls[0].init.body instanceof FormData);
});

test('a 403 explains the permission problem in plain words', async () => {
  globalThis.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch;
  await assert.rejects(createPunchItem(env, 'tok', '11:501', { name: 'x', description: 'd' }), /permission/);
});
