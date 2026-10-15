import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTask, jiraSite, toAdf } from './trackers.ts';

test('jira site accepts short names, hosts and URLs', () => {
  assert.equal(jiraSite('acme'), 'acme.atlassian.net');
  assert.equal(jiraSite('acme.atlassian.net'), 'acme.atlassian.net');
  assert.equal(jiraSite('https://acme.atlassian.net/jira/your-work'), 'acme.atlassian.net');
  assert.throws(() => jiraSite('  '));
});

test('ADF has one paragraph per non-empty line', () => {
  const doc = toAdf('Owner: Maya\n\nSaid: "send it"');
  assert.equal(doc.content.length, 2);
  assert.equal(doc.content[1].content[0].text, 'Said: "send it"');
});

test('task description carries owner, quote with timestamp, source and link', () => {
  const text = describeTask(
    { owner: 'Maya', due_text: 'Thursday', quote: 'send the revised quote', quote_ms: 125_000 },
    { title: 'Site review', created_at: '2026-10-15T14:00:00Z' },
    'https://app.example.com/recording/abc',
  );
  assert.match(text, /Owner: Maya/);
  assert.match(text, /Due: Thursday/);
  assert.match(text, /Said \(at 2:05\): "send the revised quote"/);
  assert.match(text, /From: Site review, 2026-10-15/);
  assert.match(text, /https:\/\/app\.example\.com\/recording\/abc$/);
});
