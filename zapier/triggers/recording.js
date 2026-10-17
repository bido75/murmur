// "New notes": fires when a recording's notes are ready (instant, through a Murmur webhook).
const { url, check } = require('../lib');

const subscribe = async (z, bundle) => {
  const r = check(await z.request({ url: url('/webhooks'), method: 'POST', body: { url: bundle.targetUrl, events: ['recording.ready'] } }));
  return r.json;
};
const unsubscribe = async (z, bundle) => {
  await z.request({ url: url(`/webhooks/${bundle.subscribeData.id}`), method: 'DELETE' });
  return {};
};

/** The webhook body: { id, type, data: { recording, notes } } → one flat item for Zapier. */
const toItem = (b) => {
  const d = b.data || b;
  const rec = d.recording || {};
  const n = d.notes || {};
  return {
    id: rec.id,
    title: rec.title,
    created_at: rec.created_at,
    duration_minutes: Math.round((rec.duration_ms || 0) / 60000),
    template: rec.template,
    url: rec.url,
    overview: n.overview || '',
    key_points: (n.key_points || []).join('\n'),
    decisions: (n.decisions || []).map((d) => d.text).join('\n'),
    next_steps: (n.tasks || []).filter((t) => !t.done).map((t) => `${t.text}${t.owner ? ` (${t.owner})` : ''}${t.due ? ` — due ${t.due}` : ''}`).join('\n'),
    open_questions: (n.open_questions || []).join('\n'),
  };
};

const perform = (z, bundle) => [toItem(bundle.cleanedRequest)];

/** Sample data and the test step use recent recordings. */
const performList = async (z) => {
  const r = check(await z.request({ url: url('/recordings'), params: { limit: 3 } }));
  const out = [];
  for (const rec of r.json.data || []) {
    if (rec.status !== 'ready') continue;
    const notes = check(await z.request({ url: url(`/recordings/${rec.id}`) })).json;
    out.push(
      toItem({
        recording: { id: rec.id, title: rec.title, created_at: rec.date, duration_ms: (rec.minutes || 0) * 60000 },
        notes: { overview: notes.overview, key_points: notes.key_points, decisions: notes.decisions, open_questions: notes.open_questions, tasks: (notes.action_items || []).map((t) => ({ text: t.text, owner: t.owner, due: t.due_text, done: t.status === 'done' })) },
      }),
    );
  }
  return out;
};

module.exports = {
  key: 'recording_ready',
  noun: 'Recording',
  display: { label: 'New Notes', description: 'Triggers when the notes for a recording are ready.' },
  operation: {
    type: 'hook',
    performSubscribe: subscribe,
    performUnsubscribe: unsubscribe,
    perform,
    performList,
    sample: { id: '10000000-0000-0000-0000-000000000001', title: 'OAC #12', created_at: '2026-10-15T14:00:00Z', duration_minutes: 30, template: 'meeting', url: 'https://app.example.com/recording/10000000-0000-0000-0000-000000000001', overview: 'Schedule holds.', key_points: 'Steel arrives Oct 22', decisions: 'Use Hilti anchors', next_steps: 'Send RFI 14 (Maya) — due Friday', open_questions: 'Who pays for the canopy?' },
  },
};

module.exports.toItem = toItem; // for tests; removed from the app definition in index.js
