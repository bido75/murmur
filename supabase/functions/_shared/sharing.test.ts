import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consentAdvice, STATES, stateByCode } from './consent.ts';
import { normalizeMediaLink, titleFromLink } from './links.ts';
import { linkStatus, parseRecipients, publicNotes, recapEmail } from './share.ts';
import { audioDownloadUrl, botAnnouncement, createBotBody, meetingPlatform, parseBotEvent, signWebhook, statusForEvent, verifyWebhook } from './recall.ts';

// ---------- consent ----------

test('every state and DC is listed once', () => {
  assert.equal(STATES.length, 51);
  assert.equal(new Set(STATES.map((s) => s.code)).size, 51);
  assert.equal(STATES.filter((s) => s.rule === 'all_party').length, 13);
});

test('consent advice: strictest place wins; call vs in-person nuances', () => {
  assert.equal(consentAdvice('TX', ['NY'], 'phone').level, 'notice');
  const ca = consentAdvice('TX', ['CA'], 'phone');
  assert.equal(ca.level, 'everyone');
  assert.deepEqual(ca.states, ['California']);
  assert.equal(consentAdvice('OR', [], 'phone').level, 'notice', 'Oregon phone calls are one-party');
  assert.equal(consentAdvice('OR', [], 'in_person').level, 'everyone', 'Oregon in person is all-party');
  assert.equal(consentAdvice('NV', [], 'in_person').level, 'notice');
  assert.equal(consentAdvice('NV', [], 'phone').level, 'everyone');
  assert.equal(consentAdvice('TX', [null], 'phone').level, 'unknown');
  assert.equal(consentAdvice('OTHER', [], 'in_person').level, 'unknown');
  assert.match(stateByCode('MI')?.note ?? '', /disputed/);
});

// ---------- links ----------

test('link import: share pages become direct downloads', () => {
  const dbx = normalizeMediaLink('https://www.dropbox.com/scl/fi/abc/walk.m4a?rlkey=x&dl=0');
  assert.ok(dbx.ok && dbx.url.includes('dl=1') && dbx.url.includes('rlkey=x') && !dbx.url.includes('dl=0'));
  const drive = normalizeMediaLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn_op/view?usp=sharing');
  assert.ok(drive.ok && drive.url === 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMn_op&export=download&confirm=t');
  const od = normalizeMediaLink('https://1drv.ms/u/s!Abc');
  assert.ok(od.ok && od.url.includes('download=1'));
  const mp3 = normalizeMediaLink('https://cdn.example.com/pods/ep1.mp3');
  assert.ok(mp3.ok && mp3.url === 'https://cdn.example.com/pods/ep1.mp3');
});

test('link import: refuses unsafe and unsupported links with a reason', () => {
  for (const bad of ['http://example.com/a.mp3', 'https://localhost/a.mp3', 'https://192.168.1.5/a.mp3', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://user:pw@example.com/a.mp3', 'not a link', 'ftp://x.com/a.mp3']) {
    assert.equal(normalizeMediaLink(bad).ok, false, bad);
  }
  const yt = normalizeMediaLink('https://www.youtube.com/watch?v=abc');
  assert.ok(!yt.ok && /YouTube/.test(yt.reason));
  assert.ok(!normalizeMediaLink('https://us02web.zoom.us/rec/share/xyz').ok);
  assert.ok(!normalizeMediaLink('https://drive.google.com/drive/folders/abc').ok);
});

test('titles from links', () => {
  assert.equal(titleFromLink('https://x.com/a/Site%20Walk_10-14.mp3'), 'Site Walk 10-14');
  assert.equal(titleFromLink('https://drive.google.com/uc?export=download&id=1'), 'Imported from link');
});

// ---------- share + recap ----------

const src = {
  recording: { title: 'OAC meeting #12', created_at: '2026-10-15T14:00:00Z', duration_ms: 1800000, template: 'meeting' },
  summary: {
    overview: 'Schedule holds.',
    key_points: ['Steel arrives Oct 22', 'Concrete pour moved'],
    key_point_details: [{ text: 'Steel arrives Oct 22', quote: 'steel arrives on the 22nd', quote_ms: 61000, verified: true }],
    decisions: [{ text: 'Use Hilti anchors', quote: 'we go with Hilti', verified: true }, { text: 'Invented', quote: 'nope', verified: false }],
    open_questions: ['Who pays for the redesign?'],
    site_log: null,
  },
  tasks: [
    { text: 'Send RFI 14', owner: 'Maya', due_text: 'Friday', status: 'open', needs_review: false },
    { text: 'Maybe repaint', owner: null, due_text: null, status: 'open', needs_review: true },
    { text: 'Old idea', owner: null, due_text: null, status: 'dismissed', needs_review: false },
    { text: 'Order steel', owner: null, due_text: null, status: 'done', needs_review: false },
  ],
  transcript: { utterances: [{ start_ms: 61000, end_ms: 64000, speaker: 1, text: 'we go with Hilti' }], speaker_names: { '1': 'Maya' } },
};

test('shared notes include only confirmed material; transcript only when allowed', () => {
  const n = publicNotes(src, false);
  assert.deepEqual(n.decisions.map((d) => d.text), ['Use Hilti anchors']);
  assert.deepEqual(n.tasks.map((t) => t.text), ['Send RFI 14', 'Order steel']);
  assert.equal(n.tasks[1].done, true);
  assert.equal(n.transcript, null);
  assert.ok(!JSON.stringify(n).includes('user_id'));
  assert.deepEqual(publicNotes(src, true).transcript, [{ at: '1:01', speaker: 'Maya', text: 'we go with Hilti' }]);
});

test('key points say whether they were checked against the transcript', () => {
  const n = publicNotes(src, false);
  assert.deepEqual(n.key_points, [
    { text: 'Steel arrives Oct 22', verified: true },
    { text: 'Concrete pour moved', verified: false },
  ]);
  const legacy = publicNotes({ ...src, summary: { ...src.summary, key_point_details: null } }, false);
  assert.deepEqual(legacy.key_points.map((k) => k.verified), [false, false], 'key points with no quote are not verified');
  const e = recapEmail(n, { appName: 'Murmur', sender: 'olivia@acme.com', link: null, dateLabel: 'Oct 15' });
  assert.match(e.html, /not checked against the transcript/);
  assert.ok(!e.html.includes('Steel arrives Oct 22 (not checked'), 'checked key points are not marked');
});

test('link status', () => {
  assert.equal(linkStatus(null), 'missing');
  assert.equal(linkStatus({ revoked_at: '2026-01-01', expires_at: null }), 'revoked');
  assert.equal(linkStatus({ revoked_at: null, expires_at: '2020-01-01' }), 'expired');
  assert.equal(linkStatus({ revoked_at: null, expires_at: null }), 'ok');
});

test('recipients: cleaned, deduplicated, invalid reported, capped', () => {
  const r = parseRecipients('Maya@Acme.com, sam@arch.co; bad@, <pat@gc.com>\nmaya@acme.com');
  assert.deepEqual(r.valid, ['maya@acme.com', 'sam@arch.co', 'pat@gc.com']);
  assert.deepEqual(r.invalid, ['bad@']);
  assert.equal(parseRecipients(Array.from({ length: 40 }, (_, i) => `p${i}@x.com`)).valid.length, 25);
});

test('recap email escapes content and links to the notes', () => {
  const evil = { ...src, recording: { ...src.recording, title: '<script>alert(1)</script>' } };
  const e = recapEmail(publicNotes(evil, false), { appName: 'Murmur', sender: 'olivia@acme.com', link: 'https://app/s/tok', note: 'See item 2 <b>', dateLabel: 'Oct 15' });
  assert.ok(!e.html.includes('<script>'));
  assert.ok(e.html.includes('&lt;script&gt;'));
  assert.ok(e.html.includes('href="https://app/s/tok"'));
  assert.match(e.text, /Send RFI 14 \(Maya, due Friday\)/);
  assert.match(e.text, /✓ Order steel/);
  assert.ok(!e.text.includes('Maybe repaint'));
});

// ---------- meeting bot ----------

test('bot: only meeting links; announces itself; schedules ahead', () => {
  assert.equal(meetingPlatform('https://us02web.zoom.us/j/8123456789?pwd=abc'), 'zoom');
  assert.equal(meetingPlatform('https://meet.google.com/abc-defg-hij'), 'meet');
  assert.equal(meetingPlatform('https://example.com/meeting'), null);
  assert.equal(meetingPlatform('https://evil.example/?next=https://zoom.us/j/123'), null);
  const body = createBotBody({
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    joinAt: new Date(Date.now() + 3600_000).toISOString(),
    botName: 'Murmur Notetaker',
    recordingId: 'r1',
    userId: 'u1',
    announcement: botAnnouncement('olivia@acme.com', 'Murmur'),
  }) as Record<string, any>;
  assert.deepEqual(body.metadata, { recording_id: 'r1', user_id: 'u1' });
  assert.ok(body.join_at);
  assert.deepEqual(body.recording_config, { audio_mixed_mp3: {} });
  assert.equal(body.chat.on_bot_join.send_to, 'everyone');
  assert.match(body.chat.on_bot_join.message, /recording this meeting for olivia@acme.com/);
  const now = createBotBody({ meetingUrl: 'x', joinAt: new Date().toISOString(), botName: 'b', recordingId: 'r', userId: 'u', announcement: 'a' }) as Record<string, unknown>;
  assert.equal(now.join_at, undefined, 'past or immediate joins are sent without join_at');
});

test('bot webhook signatures: valid, tampered, stale, rotated', async () => {
  const secret = 'whsec_' + btoa('0123456789abcdef0123456789abcdef');
  const body = JSON.stringify({ event: 'bot.done', data: { bot: { id: 'b1', metadata: { recording_id: 'r1' } }, data: { code: 'done' } } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await signWebhook(secret, 'msg_1', ts, body);
  const h = (s: string, t = ts) => new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': s });
  await verifyWebhook(h(`v1,${sig}`), body, secret);
  await verifyWebhook(h(`v1,old= v1,${sig}`), body, secret);
  await verifyWebhook(new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` }), body, secret);
  await assert.rejects(verifyWebhook(h(`v1,${sig}`), body.replace('b1', 'b2'), secret), /Bad signature/);
  await assert.rejects(verifyWebhook(h(`v2,${sig}`), body, secret), /Bad signature/);
  await assert.rejects(verifyWebhook(h(`v1,${sig}`, String(Number(ts) - 3600)), body, secret), /Stale/);
  await assert.rejects(verifyWebhook(h(`v1,${sig}`), body, 'plain'), /not configured/);
  const e = parseBotEvent(JSON.parse(body));
  assert.deepEqual(e, { event: 'bot.done', botId: 'b1', recordingId: 'r1', code: 'done', subCode: null });
  assert.equal(statusForEvent(e)?.status, 'done');
  assert.match(statusForEvent({ ...e, event: 'bot.fatal', subCode: 'meeting_not_found' })!.detail!, /meeting_not_found/);
});

test('bot audio: mixed mp3 first, video as fallback', () => {
  assert.equal(audioDownloadUrl({}, { results: [{ status: { code: 'done' }, data: { download_url: 'https://s3/a.mp3' } }] }), 'https://s3/a.mp3');
  assert.equal(audioDownloadUrl({ recordings: [{ media_shortcuts: { video_mixed: { data: { download_url: 'https://s3/v.mp4' } } } }] }, { results: [] }), 'https://s3/v.mp4');
  assert.equal(audioDownloadUrl({}, {}), null);
});

test('follow-up email material uses only confirmed notes; open tasks with owners and dates', async () => {
  const { followupMaterial, followupSystem } = await import('./followup.ts');
  const m = followupMaterial(publicNotes(src, false), 'olivia@acme.com');
  assert.match(m, /Use Hilti anchors/);
  assert.match(m, /Send RFI 14 \(owner: Maya\) \(due: Friday\)/);
  assert.ok(!m.includes('Order steel'), 'done tasks are not next steps');
  assert.ok(!m.includes('Maybe repaint') && !m.includes('Invented'));
  assert.match(followupSystem('formal'), /formal/);
});

test('push batches: only Expo tokens, deduplicated, 100 per request', async () => {
  const { pushBatches } = await import('./push_batches.ts');
  const toks = [...Array.from({ length: 150 }, (_, i) => `ExponentPushToken[t${i}]`), 'ExponentPushToken[t1]', 'garbage', 'ExpoPushToken[x]'];
  const b = pushBatches(toks, { title: 'Notes ready', body: 'OAC', data: { recording_id: 'r1' } });
  assert.deepEqual(b.map((x) => x.length), [100, 51]);
  assert.equal(b[0][0].data?.recording_id, 'r1');
});

test('Deepgram params: auto, multi, chosen language; redaction groups; keyterms only on nova-3', async () => {
  const { deepgramParams, liveParams } = await import('./stt.ts');
  const auto = deepgramParams({ keyterms: ['Hilti'] });
  assert.equal(auto.get('detect_language'), 'true');
  assert.deepEqual(auto.getAll('keyterm'), ['Hilti']);
  assert.equal(auto.get('mip_opt_out'), 'true');
  const multi = deepgramParams({ language: 'multi' });
  assert.equal(multi.get('language'), 'multi');
  assert.equal(multi.get('detect_language'), null);
  assert.equal(deepgramParams({ language: 'pt-BR' }).get('language'), 'pt-BR');
  assert.equal(deepgramParams({ language: 'pt-BR; drop table' }).get('detect_language'), 'true', 'junk language ignored');
  assert.deepEqual(deepgramParams({ redact: ['pii', 'pci', 'evil'] }).getAll('redact'), ['pii', 'pci']);
  assert.deepEqual(deepgramParams({ model: 'nova-2', keyterms: ['x'] }).getAll('keyterm'), []);
  assert.deepEqual(deepgramParams({ keyterms: ['x'] }, false).getAll('keyterm'), []);
  assert.equal(deepgramParams({ mipOptOut: false }).get('mip_opt_out'), null);
  const live = liveParams({ language: 'multi', redact: ['phi'] });
  assert.equal(live.get('interim_results'), 'true');
  assert.equal(live.get('endpointing'), '100');
  assert.deepEqual(live.getAll('redact'), ['phi']);
});

test('translation chunks keep every line in order', async () => {
  const { chunkLines, LANGUAGES } = await import('./translate.ts');
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
  const chunks = chunkLines(lines, 120);
  assert.deepEqual(chunks.map((c) => c.length), [120, 120, 60]);
  assert.deepEqual(chunks.flat(), lines);
  assert.equal(chunkLines(['a'.repeat(8000), 'b'.repeat(8000)], 120, 12000).length, 2);
  assert.ok(LANGUAGES.length >= 30);
});

test('a normalized Drive link stays valid when checked again', () => {
  const once = normalizeMediaLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn_op/view');
  assert.ok(once.ok);
  const twice = normalizeMediaLink(once.ok ? once.url : '');
  assert.ok(twice.ok && twice.url === (once.ok ? once.url : ''));
});
