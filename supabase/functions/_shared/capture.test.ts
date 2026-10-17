import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { aircallTitle, callAllowed, keypadToE164, parseAircall, spokenNumber, twilioSignature, twimlAskPin, twimlDial, verifyTwilio, xml } from './phone.ts';
import { cleanLocalTranscript, segmentPath, uploadType, whisperToUtterances } from './ingest.ts';

test('Twilio signatures match an independent HMAC and reject tampering', async () => {
  const url = 'https://x.supabase.co/functions/v1/phone/recording?rid=abc';
  const params = { CallSid: 'CA1', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1', Digits: '1234' };
  const data = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join('');
  const expected = createHmac('sha1', 'tok').update(data).digest('base64');
  assert.equal(await twilioSignature('tok', url, params), expected);
  assert.equal(await verifyTwilio('tok', url, params, expected), true);
  assert.equal(await verifyTwilio('tok', url, { ...params, Digits: '9999' }, expected), false);
  assert.equal(await verifyTwilio('tok', url.replace('abc', 'xyz'), params, expected), false);
  assert.equal(await verifyTwilio('', url, params, expected), false);
  assert.equal(await verifyTwilio('tok', url, params, null), false);
});

test('keypad numbers, allowed destinations and spoken numbers', () => {
  assert.equal(keypadToE164('5125550123'), '+15125550123');
  assert.equal(keypadToE164('15125550123'), '+15125550123');
  assert.equal(keypadToE164('011442071234567'), '+442071234567');
  assert.equal(keypadToE164('442071234567'), '+442071234567');
  assert.equal(keypadToE164('123'), null);
  assert.equal(keypadToE164('0123456789'), null);
  assert.equal(callAllowed('+15125550123', undefined), true);
  assert.equal(callAllowed('+442071234567', undefined), false, 'US/Canada only by default');
  assert.equal(callAllowed('+442071234567', '+1, +44'), true);
  assert.equal(callAllowed('+19005550123', '+1'), false, 'premium numbers blocked');
  assert.equal(spokenNumber('+15125550123'), '5 1 2, 5 5 5, 0 1 2 3');
});

test('TwiML is escaped and records both sides with a notice to each', () => {
  assert.equal(xml(`a&b<"'>`), 'a&amp;b&lt;&quot;&apos;&gt;');
  const pin = twimlAskPin('https://x/phone/pin?a=1&b=2', 'Murmur & Co');
  assert.match(pin, /action="https:\/\/x\/phone\/pin\?a=1&amp;b=2"/);
  assert.match(pin, /Murmur &amp; Co/);
  const dial = twimlDial({ to: '+15125550123', callerId: '+18005550100', announceUrl: 'https://x/phone/announce', recordingCallback: 'https://x/phone/recording?rid=r1' });
  assert.match(dial, /record="record-from-answer-dual"/);
  assert.match(dial, /<Number url="https:\/\/x\/phone\/announce" method="POST">\+15125550123<\/Number>/);
  assert.match(dial, /being recorded/);
  assert.ok(dial.indexOf('being recorded') < dial.indexOf('<Dial'), 'caller hears the notice before dialing');
});

test('Aircall webhooks: fields we use, and titles', () => {
  const p = parseAircall({ event: 'call.ended', token: 'wh_tok', data: { id: 812, direction: 'inbound', started_at: 1760630400, duration: 312, recording: 'https://aircall-recordings.s3/x.mp3', raw_digits: '+1 512-555-0123', contact: { first_name: 'Sam', last_name: 'Lee' }, user: { email: 'rep@acme.com' } } });
  assert.equal(p.event, 'call.ended');
  assert.equal(p.token, 'wh_tok');
  assert.equal(p.call?.id, '812');
  assert.equal(p.call?.startedAt, '2025-10-16T16:00:00.000Z');
  assert.equal(p.call?.recordingUrl, 'https://aircall-recordings.s3/x.mp3');
  assert.equal(aircallTitle(p.call!), 'Call from Sam Lee');
  const q = parseAircall({ event: 'call.ended', data: { id: 1, direction: 'outbound', recording: 'http://insecure', raw_digits: '+44 20' } });
  assert.equal(q.call?.recordingUrl, null);
  assert.equal(aircallTitle(q.call!), 'Call with +44 20');
  assert.equal(parseAircall(null).call, null);
});

test('device uploads: accepted types and paths', () => {
  assert.deepEqual(uploadType('audio/webm;codecs=opus'), { type: 'audio/webm', ext: 'webm', video: false });
  assert.deepEqual(uploadType('video/webm'), { type: 'video/webm', ext: 'webm', video: true });
  assert.equal(uploadType('application/pdf'), null);
  assert.equal(segmentPath('u', 'r', 3, 'm4a'), 'u/r/seg-0003.m4a');
});

test('on-device transcripts: whisper segments become paragraphs; bad input refused', () => {
  const u = whisperToUtterances([
    { text: ' Morning walk.', t0: 0, t1: 150 },
    { text: ' [MUSIC] Level two is done.', t0: 160, t1: 400 },
    { text: ' Next item.', t0: 700, t1: 800 },
  ]);
  assert.deepEqual(u, [
    { start_ms: 0, end_ms: 4000, speaker: 0, text: 'Morning walk. Level two is done.' },
    { start_ms: 7000, end_ms: 8000, speaker: 0, text: 'Next item.' },
  ]);
  assert.deepEqual(cleanLocalTranscript(u), u);
  assert.equal(cleanLocalTranscript([]), null);
  assert.equal(cleanLocalTranscript([{ start_ms: 5000, end_ms: 4000, text: 'x' }]), null);
  assert.equal(cleanLocalTranscript([{ start_ms: 9000, end_ms: 9500, text: 'a' }, { start_ms: 1000, end_ms: 2000, text: 'b' }]), null, 'out of order');
  assert.equal(cleanLocalTranscript([{ start_ms: 0, end_ms: 10, text: '   ' }]), null);
});

test('WAV header and PCM level', async () => {
  const { wavHeader, pcmLevelDb } = await import('./ingest.ts');
  const h = wavHeader(32000);
  const v = new DataView(h.buffer);
  assert.equal(new TextDecoder().decode(h.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(h.slice(8, 16)), 'WAVEfmt ');
  assert.equal(v.getUint32(4, true), 36 + 32000);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000);
  assert.equal(v.getUint32(40, true), 32000);
  // A full-scale square wave is 0 dBFS; silence is the floor.
  const loud = new Uint8Array(400);
  const lv = new DataView(loud.buffer);
  for (let i = 0; i < 200; i++) lv.setInt16(i * 2, i % 2 ? 32767 : -32768, true);
  assert.ok(Math.abs(pcmLevelDb(loud)) < 0.01);
  assert.equal(pcmLevelDb(new Uint8Array(400)), -160);
  // Python reads the file as valid 16 kHz mono audio.
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const f = join(mkdtempSync(join(tmpdir(), 'wav-')), 'a.wav');
  writeFileSync(f, Buffer.concat([wavHeader(400), loud]));
  const out = execFileSync('python3', ['-I', '-c', 'import wave,sys;w=wave.open(sys.argv[1]);print(w.getframerate(),w.getnchannels(),w.getsampwidth(),w.getnframes())', f]).toString().trim();
  assert.equal(out, '16000 1 2 200');
});

test('library photos placed by their EXIF time', async () => {
  const { exifTakenAt, photoMoment } = await import('./ingest.ts');
  // 09:12:30 at UTC-5 = 14:12:30 UTC
  assert.equal(exifTakenAt({ DateTimeOriginal: '2026:10:15 09:12:30', OffsetTimeOriginal: '-05:00' }), Date.parse('2026-10-15T14:12:30Z'));
  // No offset: the phone's zone (here given as UTC-4 → getTimezoneOffset() = 240)
  assert.equal(exifTakenAt({ DateTimeOriginal: '2026:10:15 09:12:30' }, 240), Date.parse('2026-10-15T13:12:30Z'));
  assert.equal(exifTakenAt({ '{Exif}': { DateTimeOriginal: '2026:10:15 09:12:30' } }, 0), Date.parse('2026-10-15T09:12:30Z'));
  assert.equal(exifTakenAt({ DateTimeOriginal: '0000:00:00 00:00:00' }), null);
  assert.equal(exifTakenAt({}), null);
  const start = '2026-10-15T14:00:00Z';
  assert.equal(photoMoment(Date.parse('2026-10-15T14:12:30Z'), start, 30 * 60_000), 750_000);
  assert.equal(photoMoment(Date.parse('2026-10-15T13:59:30Z'), start, 30 * 60_000), 0, 'just before: start');
  assert.equal(photoMoment(Date.parse('2026-10-15T16:00:00Z'), start, 30 * 60_000), null, 'long after');
  assert.equal(photoMoment(null, start, 1000), null);
});

test('RingCentral: sign-in, subscription, session events and recordings', async () => {
  const rc = await import('./ringcentral.ts');
  const u = new URL(rc.rcAuthorizeUrl('https://platform.ringcentral.com', 'cid', 'https://x/cb', 'st'));
  assert.equal(u.pathname, '/restapi/oauth/authorize');
  assert.equal(u.searchParams.get('state'), 'st');
  const t = rc.rcTokenRequest('cid', 'sec', { grant_type: 'refresh_token', refresh_token: 'r' });
  assert.equal(t.headers.Authorization, `Basic ${btoa('cid:sec')}`);
  assert.equal(t.body.get('refresh_token'), 'r');
  assert.deepEqual(rc.rcSubscriptionBody('https://h', 'v').deliveryMode, { transportType: 'WebHook', address: 'https://h', verificationToken: 'v' });
  const ended = rc.parseRcSession({ body: { telephonySessionId: 's-1', parties: [{ extensionId: '101', direction: 'Inbound', status: { code: 'Disconnected' }, from: { phoneNumber: '+15125550123', name: 'Sam Lee' } }] } });
  assert.deepEqual(ended, { sessionId: 's-1', ended: true, direction: 'Inbound', other: '+15125550123', otherName: 'Sam Lee' });
  assert.equal(rc.rcCallTitle(ended!), 'Call from Sam Lee');
  assert.equal(rc.parseRcSession({ body: { telephonySessionId: 's-2', parties: [{ extensionId: '1', status: { code: 'Answered' } }] } })?.ended, false);
  assert.equal(rc.parseRcSession({}), null);
  assert.deepEqual(rc.recordingFromCallLog({ records: [{ duration: 125, startTime: '2026-10-16T15:00:00Z', recording: { id: 99, contentUri: 'https://media.ringcentral.com/restapi/v1.0/account/1/recording/99/content' } }] }), { id: '99', contentUri: 'https://media.ringcentral.com/restapi/v1.0/account/1/recording/99/content', durationSec: 125, startTime: '2026-10-16T15:00:00Z' });
  assert.equal(rc.recordingFromCallLog({ records: [{ duration: 5 }] }), null);
});
