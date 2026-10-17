import { call } from './api.js';

const app = document.getElementById('app');
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const clock = (ms) => {
  const t = Math.floor(ms / 1000);
  const hh = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
};
const TEMPLATES = [['meeting', 'Meeting'], ['sales_call', 'Sales call'], ['interview', 'Interview'], ['lecture', 'Lecture / video'], ['general', 'General']];
const CONSENT = [['told_everyone', 'I told everyone it’s being recorded'], ['in_invite', 'It was in the invite'], ['solo', 'Only me (e.g. a video)']];
let timer = null;

async function render(error) {
  clearInterval(timer);
  const { token } = await chrome.storage.local.get('token');
  const { rec = {} } = await chrome.storage.session.get('rec');
  app.replaceChildren(...(token ? (rec.status === 'recording' || rec.status === 'uploading' ? recordingView(rec) : homeView(rec)) : linkView()).filter(Boolean));
  if (error) app.append(h('div', { class: 'banner', role: 'alert' }, error));
}

function linkView() {
  const input = h('input', { type: 'text', class: 'code', placeholder: 'XXXX-XXXX', maxlength: '9', 'aria-label': 'Link code' });
  const btn = h('button', { class: 'primary', onclick: async () => {
    btn.disabled = true;
    try {
      const { token } = await call('link', { code: input.value, name: navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome', kind: 'extension' });
      await chrome.storage.local.set({ token });
      render();
    } catch (e) {
      btn.disabled = false;
      render(e.message);
    }
  } }, 'Link');
  return [
    h('h1', {}, 'Link Murmur'),
    h('p', { class: 'muted' }, 'In the Murmur app, open Settings → Devices → Show a code, and type it here.'),
    input,
    btn,
  ];
}

function homeView(rec) {
  const title = h('input', { type: 'text', placeholder: 'Title (optional)', 'aria-label': 'Title' });
  const template = h('select', { 'aria-label': 'Type' }, ...TEMPLATES.map(([v, l]) => h('option', { value: v }, l)));
  let consent = '';
  const mic = h('input', { type: 'checkbox', checked: true });
  const go = h('button', { class: 'record', disabled: true, onclick: async () => {
    go.disabled = true;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const r = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id, title: title.value.trim() || tab.title?.slice(0, 120) || '', template: template.value, consent, withMic: mic.checked });
    render(r?.error);
  } }, '● Record this tab');
  return [
    h('h1', {}, 'Record this tab'),
    rec.status === 'done' && h('p', { class: 'muted' }, 'Last recording uploaded. Notes will be in the Murmur app shortly.'),
    rec.status === 'error' && rec.error && h('div', { class: 'banner' }, rec.error),
    title,
    template,
    h('label', { class: 'row' }, mic, h('span', {}, 'Include my microphone')),
    h('p', { class: 'muted' }, 'Many places require everyone’s permission to record.'),
    ...CONSENT.map(([v, l]) =>
      h('label', { class: 'row' }, h('input', { type: 'radio', name: 'consent', onchange: () => { consent = v; go.disabled = false; } }), h('span', {}, l))),
    go,
    h('button', { class: 'link', onclick: () => chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }) }, 'Allow microphone'),
    h('button', { class: 'link', onclick: async () => { await chrome.storage.local.remove('token'); render(); } }, 'Unlink this browser'),
  ];
}

function recordingView(rec) {
  const t = h('div', { class: 'timer', 'aria-live': 'off' }, clock(Date.now() - rec.startedAt));
  if (rec.status === 'recording') timer = setInterval(() => (t.textContent = clock(Date.now() - rec.startedAt)), 500);
  return [
    h('p', { class: 'muted', style: 'text-align:center' }, rec.status === 'recording' ? `Recording: ${rec.title || 'this tab'}` : 'Uploading…'),
    t,
    h('button', { class: 'record', disabled: rec.status !== 'recording', onclick: async () => {
      const r = await chrome.runtime.sendMessage({ type: 'stop' });
      render(r?.error);
    } }, 'Stop'),
    h('p', { class: 'muted' }, 'You can close this popup; recording continues. Each 5-minute part uploads as you go.'),
  ];
}

chrome.storage.session.onChanged.addListener(() => render());
render();
