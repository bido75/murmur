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
