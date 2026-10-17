// Service worker: starts and stops tab recording. The audio itself is handled by an offscreen
// document (service workers can't use MediaRecorder).
const OFFSCREEN = 'offscreen.html';

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({ url: OFFSCREEN, reasons: ['USER_MEDIA'], justification: 'Record tab audio and the microphone for meeting notes' });
}

async function setState(patch) {
  const { rec = {} } = await chrome.storage.session.get('rec');
  const next = { ...rec, ...patch };
  await chrome.storage.session.set({ rec: next });
  chrome.action.setBadgeText({ text: next.status === 'recording' ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#B42318' });
  return next;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'start') {
      const { token } = await chrome.storage.local.get('token');
      if (!token) throw new Error('Link this browser first.');
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: msg.tabId });
      await ensureOffscreen();
      await setState({ status: 'starting', startedAt: Date.now(), title: msg.title, error: null });
      const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, token, title: msg.title, template: msg.template, consent: msg.consent, withMic: msg.withMic });
      if (r?.error) throw new Error(r.error);
      await setState({ status: 'recording', recordingId: r.recordingId, startedAt: Date.now() });
      return { ok: true };
    }
    if (msg.type === 'stop') {
      await setState({ status: 'uploading' });
      const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
      await setState({ status: r?.error ? 'error' : 'done', error: r?.error ?? null });
      await chrome.offscreen.closeDocument().catch(() => {});
      return r ?? { ok: true };
    }
    if (msg.type === 'offscreen-error') {
      await setState({ status: 'error', error: msg.error });
      return { ok: true };
    }
    return null;
  })()
    .then(reply)
    .catch(async (e) => {
      await setState({ status: 'error', error: e.message });
      reply({ error: e.message });
    });
  return true; // async reply
});
