import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignPhotos, attachPhotosToLog, buildKeyterms, formatSiteLog, siteLogIsEmpty, SITE_TERMS, verifySiteLog } from './field.ts';
import type { Utterance } from './verify.ts';

const walk: Utterance[] = [
  { start_ms: 0, end_ms: 5000, speaker: 0, text: 'Morning walk, it is cold and windy, about forty degrees.' },
  { start_ms: 5000, end_ms: 11000, speaker: 0, text: 'Apex Electric has six guys on level two pulling wire.' },
  { start_ms: 11000, end_ms: 20000, speaker: 1, text: 'Over here at the level three riser the firestopping is missing around the conduit.' },
  { start_ms: 20000, end_ms: 26000, speaker: 0, text: 'And the guardrail on the east stair is loose, somebody could fall.' },
  { start_ms: 60000, end_ms: 66000, speaker: 1, text: 'Drywall delivery came in this morning, forty sheets.' },
  { start_ms: 90000, end_ms: 97000, speaker: 0, text: 'Framing inspection on level four passed this morning.' },
];

const raw = {
  weather: { text: 'Cold and windy, about 40°F', quote: 'it is cold and windy, about forty degrees' },
  manpower: [
    { company_or_trade: 'Apex Electric', count: 6, quote: 'Apex Electric has six guys on level two' },
    { company_or_trade: 'apex electric', count: 6, quote: 'Apex Electric has six guys on level two' },
  ],
  work_completed: [{ text: 'Pulling wire', location: 'Level 2', quote: 'six guys on level two pulling wire' }],
  issues: [
    { text: 'Firestopping missing around conduit', location: 'Level 3 riser', category: 'quality' as const, quote: 'the firestopping is missing around the conduit' },
    { text: 'Loose guardrail', location: 'East stair', category: 'safety' as const, quote: 'the guardrail on the east stair is loose' },
    { text: 'Scaffold tag expired', location: null, category: 'safety' as const, quote: 'the scaffold tag has expired on the north side' },
  ],
  deliveries: [{ text: '40 sheets of drywall', quote: 'Drywall delivery came in this morning, forty sheets' }],
  inspections: [{ text: 'Framing inspection, level 4', result: 'Passed', quote: 'Framing inspection on level four passed this morning' }],
  delays: [],
};

test('site log: verified quotes get times, invented ones are flagged, duplicates dropped', () => {
  const log = verifySiteLog(raw, walk);
  assert.equal(log.weather?.verified, true);
  assert.equal(log.manpower.length, 1);
  assert.equal(log.manpower[0].count, 6);
  assert.equal(log.issues[0].quote_ms, 11000);
  assert.equal(log.issues[1].quote_ms, 20000);
  assert.equal(log.issues[2].verified, false, 'the scaffold tag was never mentioned');
  assert.equal(log.inspections[0].quote_ms, 90000);
  assert.equal(siteLogIsEmpty(log), false);
});

test('site log: junk from the model is cleaned, not trusted', () => {
  const log = verifySiteLog(
    {
      manpower: [{ company_or_trade: '  ', count: 3, quote: 'x' }, { company_or_trade: 'Crew', count: -4 as number, quote: 'nope' }],
      issues: [{ text: 'Thing', location: '', category: 'nonsense' as never, quote: '' }],
    },
    walk,
  );
  assert.equal(log.manpower.length, 1);
  assert.equal(log.manpower[0].count, null);
  assert.equal(log.issues[0].category, 'other');
  assert.equal(log.issues[0].location, null);
  assert.equal(log.issues[0].verified, false);
  assert.equal(log.weather, null);
  assert.equal(siteLogIsEmpty(verifySiteLog(null, walk)), true);
});

test('photos go to the nearest item said within the window', () => {
  const items = [
    { quote_ms: 11000, verified: true }, // firestop
    { quote_ms: 20000, verified: true }, // guardrail
    { quote_ms: 60000, verified: true }, // delivery
    { quote_ms: 30000, verified: false }, // unverified: never gets photos
  ];
  const photos = [
    { id: 'p-firestop', taken_ms: 14000 }, // 3 s after firestop, 6 s before guardrail
    { id: 'p-guardrail', taken_ms: 24000 },
    { id: 'p-late', taken_ms: 200000 }, // nothing near
    { id: 'p-before-delivery', taken_ms: 50000 }, // 10 s before delivery words
    { id: 'p-added-later', taken_ms: null },
  ];
  assert.deepEqual(assignPhotos(items, photos), [['p-firestop'], ['p-guardrail'], ['p-before-delivery'], []]);
});

test('a photo taken long before the words is not linked', () => {
  assert.deepEqual(assignPhotos([{ quote_ms: 60000, verified: true }], [{ id: 'p', taken_ms: 40000 }]), [[]]);
  assert.deepEqual(assignPhotos([{ quote_ms: 60000, verified: true }], [{ id: 'p', taken_ms: 104000 }]), [['p']]);
});

test('photos attach to site-log issues', () => {
  const log = attachPhotosToLog(verifySiteLog(raw, walk), [{ id: 'p1', taken_ms: 13000 }, { id: 'p2', taken_ms: 23000 }]);
  assert.deepEqual(log.issues[0].photo_ids, ['p1']);
  assert.deepEqual(log.issues[1].photo_ids, ['p2']);
});

test('formatted log lists verified entries, safety first among issues', () => {
  const text = formatSiteLog(verifySiteLog(raw, walk), { title: 'Riverside Lofts site walk', date: '2026-10-15', link: 'https://app/recording/1' });
  assert.match(text, /Weather: Cold and windy/);
  assert.match(text, /Apex Electric: 6/);
  assert.match(text, /Safety:\n- Loose guardrail \(East stair\)/);
  assert.match(text, /Issues:\n- Firestopping missing around conduit \(Level 3 riser\) \[quality\]/);
  assert.match(text, /Framing inspection, level 4: Passed/);
  assert.doesNotMatch(text, /Scaffold/);
  assert.match(text, /https:\/\/app\/recording\/1$/);
});

test('keyterms: project words first, deduplicated, placeholders skipped, capped', () => {
  const terms = buildKeyterms({ vocabulary: ['Hilti', 'level 3, riser', 'hilti'], projectName: 'Riverside Lofts', names: ['Maya Chen', 'Speaker 2', 'M'], template: 'site_walk' });
  assert.deepEqual(terms.slice(0, 4), ['Hilti', 'level 3 riser', 'Riverside Lofts', 'Maya Chen']);
  assert.ok(terms.includes('RFI'));
  assert.ok(!terms.includes('Speaker 2'));
  assert.equal(buildKeyterms({ template: 'meeting' }).length, 0);
  const many = buildKeyterms({ vocabulary: Array.from({ length: 200 }, (_, i) => `term number ${i}`) });
  assert.equal(many.length, 50);
  assert.ok(many.join('').length <= 1600);
  assert.ok(!buildKeyterms({ template: 'meeting' }).some((t) => SITE_TERMS.includes(t)));
});

test('site walks ask the model for a site log; other templates do not', async () => {
  const { notesTool, systemPrompt, NOTES_TOOL } = await import('./prompts.ts');
  const walkTool = notesTool('site_walk');
  assert.ok('site_log' in walkTool.input_schema.properties);
  assert.ok((walkTool.input_schema.required as readonly string[]).includes('site_log'));
  assert.equal(notesTool('meeting'), NOTES_TOOL);
  assert.ok(!('site_log' in NOTES_TOOL.input_schema.properties), 'base tool is not mutated');
  assert.match(systemPrompt('site_walk'), /site_log/);
  assert.doesNotMatch(systemPrompt('meeting'), /site_log/);
});

test('report photos: safety first, captions from what was said, unlinked last', async () => {
  const { captionPhotos } = await import('./field.ts');
  const log = attachPhotosToLog(verifySiteLog(raw, walk), [{ id: 'p-fire', taken_ms: 13000 }, { id: 'p-rail', taken_ms: 23000 }]);
  const base = { recording_id: 'r1', caption: null, width: 1600, height: 1200, storage_path: 'x' };
  const out = captionPhotos(
    [
      { ...base, id: 'p-misc', taken_ms: 5000, caption: 'North elevation' },
      { ...base, id: 'p-fire', taken_ms: 13000 },
      { ...base, id: 'p-rail', taken_ms: 23000 },
      { ...base, id: 'p-task', taken_ms: 70000 },
    ],
    [{ recording_id: 'r1', site_log: log }],
    [{ text: 'Reorder drywall', quote: 'Drywall delivery came in', photo_ids: ['p-task'] }],
    { r1: 'Monday walk' },
  );
  assert.deepEqual(out.map((p) => p.id), ['p-rail', 'p-fire', 'p-task', 'p-misc']);
  assert.equal(out[0].title, 'Loose guardrail');
  assert.equal(out[0].detail, 'Safety · East stair');
  assert.match(out[1].quote ?? '', /firestopping/);
  assert.equal(out[3].title, 'North elevation');
  assert.equal(out[3].detail, 'Monday walk · at 0:05');
  assert.equal(out[3].linked, false);
});
