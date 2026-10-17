// Mixes the tab's audio with the microphone and records WebM/Opus in 5-minute parts, uploading
// each part as soon as it's done. The tab keeps playing through the speakers.
import { call, uploadPart } from './api.js';
import { SEGMENT_MS } from './config.js';

const MIME = 'audio/webm;codecs=opus';
let s = null; // current session

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== 'offscreen') return false;
  (msg.type === 'start' ? start(msg) : stop()).then(reply, (e) => reply({ error: e.message }));
  return true;
});

async function start({ streamId, token, title, template, consent, withMic }) {
  if (s) throw new Error('Already recording');
  const tab = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } });
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const tabSrc = ctx.createMediaStreamSource(tab);
  tabSrc.connect(dest);
  tabSrc.connect(ctx.destination); // capturing mutes the tab unless we play it back
  const streams = [tab];
  if (withMic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      ctx.createMediaStreamSource(mic).connect(dest);
      streams.push(mic);
    } catch {
      chrome.runtime.sendMessage({ type: 'offscreen-error', error: 'Microphone blocked — recording the tab only. Allow it from the extension’s “Allow microphone” page.' });
    }
  }
  const { recording_id } = await call('start', { title, template, consent_method: consent }, token);
  s = { token, recordingId: recording_id, ctx, dest, streams, idx: 0, parts: [], uploads: [], startedAt: Date.now(), recorder: null, timer: null };
  openPart();
  s.timer = setInterval(() => {
    if (Date.now() - s.partStartedAt >= SEGMENT_MS) rotate();
  }, 1000);
  // The tab being closed ends the capture: finish up.
  tab.getAudioTracks()[0].addEventListener('ended', () => {
    if (s) chrome.runtime.sendMessage({ type: 'stop' });
  });
  return { recordingId: recording_id };
}

function openPart() {
  s.idx += 1;
  const idx = s.idx;
  const chunks = [];
  const rec = new MediaRecorder(s.dest.stream, { mimeType: MIME, audioBitsPerSecond: 64000 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const startedAt = Date.now();
  const done = new Promise((resolve) => {
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const durationMs = Date.now() - startedAt;
      if (blob.size > 2048) {
        s.parts.push({ idx, ext: 'webm', duration_ms: durationMs });
        s.uploads.push(uploadPart(s.token, s.recordingId, idx, blob));
      }
      resolve();
    };
  });
  rec.start(5000);
  s.recorder = rec;
  s.partStartedAt = startedAt;
  s.partDone = done;
}

function rotate() {
  const old = s.recorder;
  openPart();
  old.stop();
}

async function stop() {
  if (!s) return { ok: true };
  clearInterval(s.timer);
  const last = s.partDone;
  s.recorder.stop();
  await last;
  const session = s;
  s = null;
  session.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
  await session.ctx.close();
  await Promise.all(session.uploads);
  if (!session.parts.length) return { error: 'Nothing was recorded.' };
  await call('finish', { recording_id: session.recordingId, duration_ms: Date.now() - session.startedAt, segments: session.parts }, session.token);
  return { ok: true, recordingId: session.recordingId };
}
