import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zip } from './zip.ts';
import { folderNames, notesMarkdown, slug, tasksCsv, transcriptText } from './export_data.ts';
import { activeFrom, emailOf, listResponse, parseFilter, userResource } from './scim.ts';
import type { PublicNotes } from './share.ts';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip files open with a standard unzip tool', () => {
  const z = zip([{ name: 'a.txt', data: 'hello' }, { name: 'recordings/2026-10-15-oac/notes.md', data: '# OAC — “ok”' }]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  writeFileSync(join(dir, 'x.zip'), z);
  const out = execFileSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(z.namelist()));print(z.read("recordings/2026-10-15-oac/notes.md").decode())', join(dir, 'x.zip')]).toString();
  assert.match(out, /a\.txt\|recordings\/2026-10-15-oac\/notes\.md/);
  assert.match(out, /# OAC — “ok”/);
});

const n: PublicNotes = {
  title: 'OAC #12', date: '2026-10-15T14:00:00Z', duration_ms: 1800000, template: 'site_walk', overview: 'Holds.', key_points: ['Steel Oct 22'],
  decisions: [{ text: 'Hilti', quote: 'go with Hilti' }], tasks: [{ text: 'RFI 14', owner: 'Maya', due: 'Fri', done: true }], open_questions: [],
  site_log: [{ title: 'Safety', items: ['Guardrail'] }], transcript: [{ at: '0:05', speaker: 'Vinny', text: 'Morning.' }],
};

test('export files: names, markdown, transcript and safe CSV', () => {
  assert.equal(slug('OAC #12 — Riverside Lofts!'), 'oac-12-riverside-lofts');
  const names = folderNames([{ id: 'a', title: 'OAC', created_at: '2026-10-15T01:00:00Z' }, { id: 'b', title: 'OAC', created_at: '2026-10-15T09:00:00Z' }, { id: 'c', title: '???', created_at: '2026-10-16T00:00:00Z' }]);
  assert.deepEqual([...names.values()], ['2026-10-15-oac', '2026-10-15-oac-2', '2026-10-16-recording']);
  const md = notesMarkdown(n);
  assert.match(md, /- \[x\] RFI 14 \(Maya\) — due Fri/);
  assert.match(md, /## Safety\n\n- Guardrail/);
  assert.equal(transcriptText(n), '[0:05] Vinny: Morning.\n');
  const csv = tasksCsv([{ text: '=HYPERLINK("x")', owner: 'Maya, PM', due_text: null, status: 'open', recording: 'OAC', created_at: '2026-10-15', quote: 'say "hi"' }]);
  assert.equal(csv.split('\r\n')[1], `"'=HYPERLINK(""x"")","Maya, PM",,open,OAC,2026-10-15,"say ""hi"""`);
});

test('SCIM: filters, emails, active flags and paging', () => {
  assert.deepEqual(parseFilter('userName eq "Sam@Acme.com"'), { email: 'sam@acme.com' });
  assert.deepEqual(parseFilter('emails[type eq "work"].value eq "a@b.co"'), { email: 'a@b.co' });
  assert.equal(parseFilter(null), null);
  assert.equal(parseFilter('displayName co "x"'), 'unsupported');
  assert.equal(emailOf({ userName: 'Sam@Acme.com' }), 'sam@acme.com');
  assert.equal(emailOf({ userName: 'sam', emails: [{ value: 'x@y.com' }, { value: 'p@y.com', primary: true }] }), 'p@y.com');
  assert.equal(emailOf({ userName: 'not-an-email' }), null);
  assert.equal(activeFrom({ Operations: [{ op: 'Replace', path: 'active', value: 'false' }] }), false);
  assert.equal(activeFrom({ Operations: [{ op: 'replace', value: { active: true } }] }), true);
  assert.equal(activeFrom({ Operations: [{ op: 'replace', path: 'name.givenName', value: 'Sam' }] }), undefined);
  assert.equal(activeFrom({ active: false }), false);
  const l = listResponse([1, 2, 3, 4, 5], 2, 2);
  assert.deepEqual([l.totalResults, l.startIndex, l.itemsPerPage, l.Resources], [5, 2, 2, [2, 3]]);
  const u = userResource({ user_id: 'u1', email: 'sam@acme.com', role: 'member', joined_at: '2026-10-01T00:00:00Z', active: true }, 'https://x/scim/v2');
  assert.equal(u.meta.location, 'https://x/scim/v2/Users/u1');
});
