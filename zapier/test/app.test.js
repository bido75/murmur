// Validates the app definition against Zapier's schema and checks the webhook item mapping.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const schema = require('zapier-platform-schema');
const app = require('../index');
const { toItem } = require('../triggers/recording');

test('the app definition passes Zapier schema validation', () => {
  const clean = JSON.parse(JSON.stringify(app, (k, v) => (typeof v === 'function' ? '$func$2$f$' : v)));
  const results = schema.validateAppDefinition(clean);
  assert.deepEqual(results.errors.map((e) => e.stack), []);
});

test('a Murmur webhook becomes a flat Zapier item', () => {
  const item = toItem({
    id: 'evt_1',
    type: 'recording.ready',
    data: {
    recording: { id: 'r1', title: 'OAC', created_at: '2026-10-15T14:00:00Z', duration_ms: 1800000, template: 'meeting', url: 'https://app/r1' },
    notes: { overview: 'Holds.', key_points: ['a', 'b'], decisions: [{ text: 'Hilti', quote: 'x' }], tasks: [{ text: 'RFI 14', owner: 'Maya', due: 'Fri', done: false }, { text: 'Shims', done: true }], open_questions: [] },
    },
  });
  assert.equal(item.duration_minutes, 30);
  assert.equal(item.key_points, 'a\nb');
  assert.equal(item.next_steps, 'RFI 14 (Maya) — due Fri');
});
