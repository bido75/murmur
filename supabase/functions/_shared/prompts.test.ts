import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capForNotes, NOTES_MAX_TRANSCRIPT_CHARS, userMessage } from './prompts.ts';

test('a transcript within the budget is passed through unchanged', () => {
  const t = 'hello world';
  assert.equal(capForNotes(t), t);
  const big = 'x'.repeat(NOTES_MAX_TRANSCRIPT_CHARS);
  assert.equal(capForNotes(big), big);
});

test('an over-long transcript is cut to the budget with a visible truncation marker', () => {
  const t = `${'a'.repeat(NOTES_MAX_TRANSCRIPT_CHARS + 50)} tail`;
  const capped = capForNotes(t);
  assert.equal(capped.length, NOTES_MAX_TRANSCRIPT_CHARS + '\n…[transcript truncated for the notes]'.length);
  assert.match(capped, /\[transcript truncated for the notes\]$/);
  assert.ok(capped.startsWith('a'), 'keeps the beginning of the recording');
});

test('the notes prompt carries the capped transcript', () => {
  const msg = userMessage('x'.repeat(NOTES_MAX_TRANSCRIPT_CHARS + 100), []);
  assert.ok(msg.length < NOTES_MAX_TRANSCRIPT_CHARS + 1000);
  assert.match(msg, /transcript truncated/);
});
