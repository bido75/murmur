import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropRepeats, findQuote, formatClock, makeRefs, offsetUtterances, verifyActionItems, verifyKeyPoints, verifyTaskUpdates, type Utterance } from './verify.ts';

const transcript: Utterance[] = [
  { start_ms: 0, end_ms: 4000, speaker: 0, text: "Okay, let's get started with the site review." },
  { start_ms: 4000, end_ms: 9000, speaker: 1, text: 'Maya, can you send the revised quote by Thursday?' },
  { start_ms: 9000, end_ms: 12000, speaker: 0, text: "Yes, I'll send it over tomorrow morning." },
  { start_ms: 12000, end_ms: 18000, speaker: 1, text: 'We could maybe look at a different supplier for the rebar.' },
];

test('finds an exact quote, ignoring case and punctuation', () => {
  const m = findQuote('can you send the revised quote by thursday', transcript);
  assert.equal(m.found, true);
  assert.equal(m.start_ms, 4000);
});

test('finds a quote spanning two utterances', () => {
  const m = findQuote('revised quote by Thursday? Yes, I will', transcript);
  // "I will" vs "I'll" differs, so this goes through the fuzzy path and still lands on 4000.
  assert.equal(m.found, true);
  assert.equal(m.start_ms, 4000);
});

test('rejects a quote that was never said', () => {
  const m = findQuote('Bob will approve the budget before Friday', transcript);
  assert.equal(m.found, false);
  assert.equal(m.start_ms, null);
});

test('verified commitment with a named owner passes cleanly', () => {
  const [t] = verifyActionItems(
    [{ task: 'Send revised quote', owner: 'Maya', owner_basis: 'named', due: 'Thursday', kind: 'commitment', quote: 'Maya, can you send the revised quote by Thursday' }],
    transcript,
  );
  assert.equal(t.verified, true);
  assert.equal(t.owner, 'Maya');
  assert.equal(t.needs_review, false);
  assert.equal(t.quote_ms, 4000);
  assert.equal(t.due_text, 'Thursday');
});

test('owner never mentioned in the meeting is removed and flagged', () => {
  const [t] = verifyActionItems(
    [{ task: 'Approve budget', owner: 'Bob Smith', owner_basis: 'named', kind: 'commitment', quote: "Yes, I'll send it over tomorrow morning" }],
    transcript,
  );
  assert.equal(t.owner, null);
  assert.equal(t.owner_basis, 'unassigned');
  assert.equal(t.needs_review, true);
  assert.equal(t.verified, true);
});

test('hallucinated quote is kept but flagged unverified', () => {
  const [t] = verifyActionItems([{ task: 'Book crane', kind: 'commitment', quote: 'Book the crane for next Monday' }], transcript);
  assert.equal(t.verified, false);
  assert.equal(t.needs_review, true);
});

test('suggestions always need review', () => {
  const [t] = verifyActionItems(
    [{ task: 'Look at another rebar supplier', kind: 'suggestion', quote: 'We could maybe look at a different supplier for the rebar' }],
    transcript,
  );
  assert.equal(t.kind, 'suggestion');
  assert.equal(t.verified, true);
  assert.equal(t.needs_review, true);
});

test('drops empty and duplicate tasks', () => {
  const out = verifyActionItems(
    [
      { task: 'Send revised quote', quote: 'send the revised quote' },
      { task: 'send revised quote.', quote: 'send the revised quote' },
      { task: '   ', quote: 'x' },
    ],
    transcript,
  );
  assert.equal(out.length, 1);
});

test('clock formatting', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65_000), '1:05');
  assert.equal(formatClock(3_725_000), '1:02:05');
});

test('offsets utterances for later segments', () => {
  const [u] = offsetUtterances([transcript[0]], 600_000);
  assert.equal(u.start_ms, 600_000);
  assert.equal(u.end_ms, 604_000);
});

test('carry-over: verified done update maps back to the task id', () => {
  const refs = makeRefs([{ id: 'task-a', text: 'Send revised quote' }, { id: 'task-b', text: 'Book crane' }]);
  const out = verifyTaskUpdates(
    [
      { ref: 't1', status: 'done', quote: "Yes, I'll send it over tomorrow morning" },
      { ref: 'T1', status: 'blocked', quote: 'duplicate ref is ignored' },
      { ref: 'T9', status: 'done', quote: 'unknown ref is ignored' },
      { ref: 'T2', status: 'done', quote: 'The crane is booked for Monday' },
    ],
    refs,
    transcript,
  );
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].task_id, out[0].status, out[0].verified, out[0].quote_ms], ['task-a', 'done', true, 9000]);
  assert.deepEqual([out[1].task_id, out[1].verified], ['task-b', false]);
});

test('carry-over: repeated tasks are not created twice', () => {
  const out = dropRepeats(
    [{ text: 'Send the revised quote to the client' }, { text: 'Order rebar from new supplier' }],
    ['Send revised quote to client'],
  );
  assert.deepEqual(out.map((o) => o.text), ['Order rebar from new supplier']);
});

test('key point with a quote from the transcript gets its time', () => {
  const out = verifyKeyPoints([{ text: 'Revised quote due Thursday', quote: 'can you send the revised quote by Thursday' }], transcript);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'Revised quote due Thursday');
  assert.equal(out[0].verified, true);
  assert.equal(out[0].quote_ms, 4000);
});

test('key point whose quote is not in the transcript keeps no time', () => {
  const out = verifyKeyPoints([{ text: 'Crane booked for Monday', quote: 'the crane is booked for Monday' }], transcript);
  assert.equal(out[0].verified, false);
  assert.equal(out[0].quote_ms, null);
});

test('key point without a quote is kept but gets no time', () => {
  const out = verifyKeyPoints([{ text: 'Steel arrives on 22 October' }], transcript);
  assert.equal(out[0].text, 'Steel arrives on 22 October');
  assert.equal(out[0].verified, false);
  assert.equal(out[0].quote_ms, null);
});

test('key points given as plain strings are kept, and duplicates are dropped', () => {
  const out = verifyKeyPoints(['Steel arrives Oct 22', 'Steel arrives Oct 22', '  '], transcript);
  assert.deepEqual(out.map((o) => o.text), ['Steel arrives Oct 22']);
});
