import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMeeting, parsePs, parseTasklist, shouldPrompt } from './meetings.ts';

test('macOS: Zoom meeting detected only while CptHost runs', () => {
  const idle = parsePs('/sbin/launchd\n/Applications/zoom.us.app/Contents/MacOS/zoom.us\n');
  assert.equal(detectMeeting(idle), null);
  const inCall = parsePs('/Applications/zoom.us.app/Contents/MacOS/zoom.us\n/Applications/zoom.us.app/Contents/Frameworks/cpthost.app/Contents/MacOS/CptHost\n');
  assert.equal(detectMeeting(inCall), 'zoom');
});

test('Windows: parses tasklist CSV and detects Teams and Zoom meeting windows', () => {
  const csv = [
    '"ms-teams.exe","1234","Console","1","250,000 K","Running","ACME\\\\olivia","0:01:02","Weekly sync | Meeting | Microsoft Teams"',
    '"explorer.exe","88","Console","1","90,000 K","Running","ACME\\\\olivia","0:00:10","N/A"',
  ].join('\r\n');
  const rows = parseTasklist(csv);
  assert.equal(rows[0].name, 'ms-teams.exe');
  assert.equal(detectMeeting(rows), 'teams');
  assert.equal(detectMeeting(parseTasklist('"Zoom.exe","1","Console","1","1 K","Running","u","0:00:01","Zoom Meeting"')), 'zoom');
  assert.equal(detectMeeting(parseTasklist('"ms-teams.exe","1","Console","1","1 K","Running","u","0:00:01","Chat | Microsoft Teams"')), null);
  assert.equal(detectMeeting(parseTasklist('"CptHost.exe","1","Console","1","1 K","Running","u","0:00:01","N/A"')), 'zoom');
});

test('prompts once when a meeting starts, never while recording', () => {
  assert.equal(shouldPrompt(null, 'zoom', false), true);
  assert.equal(shouldPrompt('zoom', 'zoom', false), false);
  assert.equal(shouldPrompt(null, 'zoom', true), false);
  assert.equal(shouldPrompt('zoom', null, false), false);
});
