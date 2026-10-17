import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanActions, crmNoteText, digestEmail, matchingAutomations, meetingsToJoin, notionBlocks, oneNoteHtml, recordingEvent, signWebhook, slackMessage, topicHits, verifyWebhookSignature } from './connect.ts';
import { authorizeUrl, driveMultipart, providerConf, refreshBody, soqlString, storedConnection } from './oauth_providers.ts';
import { route } from './rest.ts';
import { isDigestTime } from './digest_time.ts';
import { hubspotDue, trelloUrl } from './trackers.ts';
import type { PublicNotes } from './share.ts';
import type { Source } from './mcp.ts';

const n: PublicNotes = {
  title: 'OAC #12 <b>',
  date: '2026-10-15T14:00:00Z',
  duration_ms: 1800000,
  template: 'meeting',
  overview: 'Schedule holds.',
  key_points: ['Steel arrives Oct 22'],
  decisions: [{ text: 'Use Hilti anchors', quote: 'we go with Hilti' }],
  tasks: [
    { text: 'Send RFI 14', owner: 'Maya', due: 'Friday', done: false },
    { text: 'Order shims', owner: null, due: null, done: true },
  ],
  open_questions: ['Who pays?'],
  site_log: [{ title: 'Safety', items: ['Loose guardrail (East stair)'] }],
  transcript: null,
};

test('webhook signatures verify, and fail when tampered or stale', async () => {
  const body = JSON.stringify(recordingEvent('recording.ready', { id: 'r1', title: 't', created_at: 'x', duration_ms: 1, template: 'meeting', project_id: null, url: null }, { notes: n }));
  const sig = await signWebhook('s3cret', body);
  assert.match(sig, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(await verifyWebhookSignature('s3cret', body, sig), true);
  assert.equal(await verifyWebhookSignature('s3cret', body + ' ', sig), false);
  assert.equal(await verifyWebhookSignature('other', body, sig), false);
  const old = await signWebhook('s3cret', body, Math.floor(Date.now() / 1000) - 3600);
  assert.equal(await verifyWebhookSignature('s3cret', body, old), false);
});

test('slack, notion and onenote messages carry confirmed content only, escaped where needed', () => {
  const s = slackMessage(n, 'https://app/r/1');
  const text = JSON.stringify(s);
  assert.match(text, /Send RFI 14 — Maya \(due Friday\)/);
  assert.ok(!text.includes('Order shims'), 'done tasks are not next steps');
  assert.match(text, /Safety/);
  assert.ok(s.blocks.some((b) => b.type === 'actions'));
  const blocks = notionBlocks(n, null);
  assert.ok(blocks.some((b) => b.type === 'to_do' && (b.to_do as { checked: boolean }).checked));
  assert.ok(blocks.length <= 100);
  const html = oneNoteHtml(n, 'https://app/r/1');
  assert.ok(html.includes('OAC #12 &lt;b&gt;') && !html.includes('<b>'));
  assert.match(html, /data-tag="to-do:completed"/);
  assert.match(crmNoteText(n, null), /Next steps:\n- Send RFI 14 \(Maya\) due Friday/);
});

test('automations match by project and type; bad actions are dropped', () => {
  const list = [
    { id: 'a', name: 'All', project_id: null, template: null, active: true, actions: [{ type: 'slack' }, { type: 'nonsense' }] },
    { id: 'b', name: 'Riverside walks', project_id: 'p1', template: 'site_walk', active: true, actions: [{ type: 'export', destination: 'notion' }] },
    { id: 'c', name: 'Off', project_id: null, template: null, active: false, actions: [{ type: 'slack' }] },
    { id: 'd', name: 'Empty', project_id: null, template: null, active: true, actions: [{ type: 'email', to: ['not-an-email'] }] },
  ];
  assert.deepEqual(matchingAutomations(list, { project_id: 'p1', template: 'site_walk' }).map((a) => a.id), ['a', 'b']);
  assert.deepEqual(matchingAutomations(list, { project_id: 'p2', template: 'site_walk' }).map((a) => a.id), ['a']);
  assert.deepEqual(cleanActions([{ type: 'webhook', url: 'http://insecure' }, { type: 'webhook', url: 'https://ok.example' }, { type: 'tracker', provider: 'linear' }]), [
    { type: 'webhook', url: 'https://ok.example' },
    { type: 'tracker', provider: 'linear' },
  ]);
});

test('topic alerts match whole phrases in the right project', () => {
  const utt = [
    { start_ms: 1000, text: 'We talked about the budget.' },
    { start_ms: 5000, text: 'The change order for the canopy is coming.' },
  ];
  const alerts = [
    { id: '1', phrase: 'Change Order', project_id: null },
    { id: '2', phrase: 'budget', project_id: 'other' },
    { id: '3', phrase: 'canopy redesign', project_id: null },
    { id: '4', phrase: 'get', project_id: null },
  ];
  assert.deepEqual(topicHits(alerts, 'p1', utt).map((h) => [h.id, h.at_ms]), [['1', 5000]]);
});

test('weekly digest and its timing', () => {
  const e = digestEmail({ recordings: [{ title: 'OAC', created_at: '2026-10-12T10:00:00Z', tasks: 2 }], open: [{ text: 'Send RFI <14>', owner: 'Maya', due: null, recording: 'OAC' }], done: 3 }, { appName: 'Murmur', appUrl: 'https://app', weekOf: '2026-10-12' });
  assert.match(e.subject, /1 recording, 1 open task/);
  assert.ok(e.html.includes('Send RFI &lt;14&gt;'));
  // Monday Oct 19 2026, 12:30 UTC = 8:30 in New York
  assert.equal(isDigestTime(new Date('2026-10-19T12:30:00Z'), 'America/New_York', null), true);
  assert.equal(isDigestTime(new Date('2026-10-19T12:30:00Z'), 'Europe/London', null), false);
  assert.equal(isDigestTime(new Date('2026-10-19T12:30:00Z'), 'America/New_York', '2026-10-17T00:00:00Z'), false, 'sent recently');
  assert.equal(isDigestTime(new Date('2026-10-19T12:30:00Z'), 'Not/AZone', null), true, 'bad zone falls back to New York');
});

test('automatic notetaker joins meetings with links starting soon, once', () => {
  const now = Date.parse('2026-10-19T13:00:00Z');
  const ev = (key: string, mins: number, url: string | null) => ({ key, start: new Date(now + mins * 60_000).toISOString(), meetingUrl: url, title: key });
  const due = meetingsToJoin([ev('a', 10, 'https://zoom.us/j/1'), ev('b', 30, 'https://zoom.us/j/2'), ev('c', 5, null), ev('d', -5, 'https://zoom.us/j/3'), ev('e', 12, 'https://meet.google.com/abc-defg-hij')], new Set([`e|${new Date(now + 12 * 60_000).toISOString()}`]), now);
  assert.deepEqual(due.map((e) => e.key), ['a']);
});

test('sign-in connections: URLs, token bodies and what is stored', () => {
  const g = providerConf('google_docs', () => undefined);
  const u = new URL(authorizeUrl(g, 'cid', 'https://x/cb', 'st'));
  assert.equal(u.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/drive.file');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(providerConf('salesforce', (k) => (k === 'SALESFORCE_LOGIN_URL' ? 'https://test.salesforce.com/' : undefined)).authorize, 'https://test.salesforce.com/services/oauth2/authorize');
  assert.equal(refreshBody('a', 'b', 'r', 'Notes.Create').get('scope'), 'Notes.Create');
  const slack = storedConnection('slack', { ok: true, team: { name: 'Acme' }, incoming_webhook: { url: 'https://hooks.slack.com/x', channel: '#site', channel_id: 'C1' } });
  assert.equal(slack.secret, 'https://hooks.slack.com/x');
  assert.deepEqual(slack.config.target, { id: 'C1', name: '#site' });
  assert.throws(() => storedConnection('slack', { ok: false, error: 'access_denied' }), /access_denied/);
  assert.throws(() => storedConnection('google_docs', { access_token: 'a' }), /refresh token/);
  assert.equal(storedConnection('salesforce', { refresh_token: 'r', access_token: 'a', instance_url: 'https://acme.my.salesforce.com' }).config.instance_url, 'https://acme.my.salesforce.com');
  assert.equal(soqlString("o'brien@x.com"), "'o\\'brien@x.com'");
});

test('Drive upload converts a .docx into a Google Doc', () => {
  const { body, contentType } = driveMultipart('Notes', new Uint8Array([80, 75, 3, 4]), 'B');
  const text = new TextDecoder().decode(body);
  assert.equal(contentType, 'multipart/related; boundary=B');
  assert.match(text, /"mimeType":"application\/vnd.google-apps.document"/);
  assert.ok(text.endsWith('\r\n--B--'));
});

test('tracker helpers', () => {
  assert.equal(new URL(trelloUrl('/cards', 'k', 't', { idList: 'L' })).searchParams.get('idList'), 'L');
  assert.equal(hubspotDue('2026-10-23'), String(Date.parse('2026-10-23T17:00:00Z')));
  assert.equal(hubspotDue(null, 0), String(7 * 86400_000));
});

test('REST API routes, validation and not-found', async () => {
  const calls: string[] = [];
  const src: Source = {
    listProjects: async () => [{ id: 'p', name: 'Riverside', team: null }],
    listRecordings: async (o) => (calls.push(`list:${o.limit}`), []),
    searchRecordings: async () => [],
    getNotes: async (id) => (id === '10000000-0000-0000-0000-000000000001' ? { overview: 'x' } : null),
    getTranscript: async () => ({ text: 'hi', next_offset: null }),
    listTasks: async (o) => (calls.push(`tasks:${o.status}`), []),
    setTaskStatus: async (id) => id === '20000000-0000-0000-0000-000000000001',
    createWebhook: async (url) => (calls.push(`hook:${url}`), { id: '30000000-0000-0000-0000-000000000001' }),
    deleteWebhook: async (id) => id === '30000000-0000-0000-0000-000000000001',
  };
  const r = (method: string, path: string, query = '', body: unknown = null) => route({ method, path, query: new URLSearchParams(query), body }, src);
  assert.equal((await r('GET', '/api/v1/projects')).status, 200);
  assert.equal((await r('GET', '/api/v1/recordings', 'limit=500')).status, 200);
  assert.deepEqual(calls, ['list:100'], 'limit capped');
  assert.equal((await r('GET', '/api/v1/recordings', 'project_id=nope')).status, 400);
  assert.equal((await r('GET', '/api/v1/recordings/10000000-0000-0000-0000-000000000001')).status, 200);
  assert.equal((await r('GET', '/api/v1/recordings/10000000-0000-0000-0000-000000000009')).status, 404);
  assert.equal((await r('GET', '/api/v1/recordings/not-a-uuid')).status, 404);
  assert.equal((await r('GET', '/api/v1/tasks', 'status=bogus')).status, 400);
  assert.equal((await r('PATCH', '/api/v1/tasks/20000000-0000-0000-0000-000000000001', '', { status: 'done' })).status, 200);
  assert.equal((await r('PATCH', '/api/v1/tasks/20000000-0000-0000-0000-000000000001', '', { status: 'deleted' })).status, 400);
  assert.equal((await r('DELETE', '/api/v1/tasks/x')).status, 404);
  assert.equal((await r('GET', '/api/v1/search', 'q=a')).status, 400);
  // Zapier-style instant triggers subscribe and unsubscribe a URL.
  assert.equal((await r('POST', '/api/v1/webhooks', '', { url: 'https://hooks.zapier.com/x' })).status, 201);
  assert.equal((await r('POST', '/api/v1/webhooks', '', { url: 'http://insecure' })).status, 400);
  assert.equal((await r('POST', '/api/v1/webhooks', '', { url: 'https://x.example', events: ['everything'] })).status, 400);
  assert.equal((await r('DELETE', '/api/v1/webhooks/30000000-0000-0000-0000-000000000001')).status, 204);
  assert.equal((await r('DELETE', '/api/v1/webhooks/30000000-0000-0000-0000-000000000009')).status, 404);
  assert.equal((await r('GET', '/api/v1/recordings', 'before=nope')).status, 400);
});
