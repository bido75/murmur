import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capForNotes, chunkTranscript, NOTES_MAX_TRANSCRIPT_CHARS, NOTES_TOOL, systemPrompt, userMessage } from './prompts.ts';

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

test('chunkTranscript keeps short transcripts whole', () => {
  assert.deepEqual(chunkTranscript('short'), ['short']);
});

test('chunkTranscript splits an over-long transcript into overlapping chunks that cover the whole text', () => {
  const blocks = Array.from({ length: 30 }, (_, i) => `line ${i} `.padEnd(8000, `.`) );
  blocks.push('the very end of the recording');
  const text = blocks.join('\n');
  const chunks = chunkTranscript(text, 10000, 500);
  assert.ok(chunks.length > 1, 'a long transcript is split');
  // Every chunk is within budget.
  for (const c of chunks) assert.ok(c.length <= 10000, 'each chunk within budget');
  // The whole transcript is covered: the end must appear in the last chunk.
  assert.match(chunks[chunks.length - 1], /the very end of the recording/);
  assert.match(chunks[0], /line 0 /, 'the first chunk keeps the beginning');
});

test('the notes schema asks for detailed sections and conclusions', () => {
  const req = NOTES_TOOL.input_schema.required;
  assert.ok(req.includes('detailed_sections'), 'detailed_sections is required');
  assert.ok(req.includes('conclusions'), 'conclusions is required');
  assert.ok(NOTES_TOOL.input_schema.properties.detailed_sections?.items, 'detailed_sections has an item schema');
});

test('systemPrompt defaults to the comprehensive detailed instruction', () => {
  const p = systemPrompt('general');
  assert.match(p, /COMPREHENSIVE notes as detailed_sections/);
});

test('systemPrompt brief tells the model to skip detailed_sections', () => {
  const p = systemPrompt('general', null, 'brief');
  assert.doesNotMatch(p, /COMPREHENSIVE notes as detailed_sections/);
  assert.match(p, /Do not fill detailed_sections/);
});

test('systemPrompt standard asks for a concise treatment', () => {
  const p = systemPrompt('general', null, 'standard');
  assert.match(p, /1–2 paragraphs/);
  assert.doesNotMatch(p, /COMPREHENSIVE notes as detailed_sections/);
});
