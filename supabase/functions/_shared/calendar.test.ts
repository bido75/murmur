import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMeetingLink, isSafeReturn, matchProject, normalizeGoogle, normalizeGraph, sortAndFilter } from './calendar.ts';

test('detects Zoom, Meet, Teams and Webex links in any field', () => {
  assert.deepEqual(detectMeetingLink('Join: https://acme.zoom.us/j/123456789?pwd=abc thanks'), { url: 'https://acme.zoom.us/j/123456789?pwd=abc', platform: 'zoom' });
  assert.equal(detectMeetingLink(null, 'https://meet.google.com/abc-defg-hij')!.platform, 'meet');
  assert.equal(detectMeetingLink('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0')!.platform, 'teams');
  assert.equal(detectMeetingLink('https://acme.webex.com/meet/jdoe')!.platform, 'webex');
  assert.equal(detectMeetingLink('Site trailer, Level 2', 'no link here'), null);
});

test('Google: recurring key, video link, attendees without self/rooms, cancelled dropped', () => {
  const e = normalizeGoogle({
    id: 'abc_20261016T140000Z', recurringEventId: 'abc', summary: 'Riverside Lofts OAC meeting',
    start: { dateTime: '2026-10-16T10:00:00-04:00' }, end: { dateTime: '2026-10-16T11:00:00-04:00' },
    conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
    attendees: [{ email: 'Me@acme.com', self: true }, { email: 'Owner@Client.com', displayName: 'Pat' }, { email: 'room-3@acme.com', resource: true }],
  })!;
  assert.equal(e.key, 'g:abc');
  assert.equal(e.start, '2026-10-16T14:00:00.000Z');
  assert.equal(e.platform, 'meet');
  assert.deepEqual(e.attendees, [{ name: 'Pat', email: 'owner@client.com' }]);
  assert.equal(e.recurring, true);
  assert.equal(normalizeGoogle({ id: 'x', status: 'cancelled', start: { dateTime: '2026-10-16T10:00:00Z' } }), null);
});

test('Microsoft Graph: UTC times without zone, Teams join URL, series key', () => {
  const e = normalizeGraph({
    id: 'occ1', seriesMasterId: 'series1', type: 'occurrence', subject: 'Weekly sync',
    start: { dateTime: '2026-10-16T14:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-16T14:30:00.0000000', timeZone: 'UTC' },
    onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
    attendees: [{ emailAddress: { name: 'Me', address: 'me@acme.com' } }, { emailAddress: { name: 'Sam', address: 'sam@acme.com' }, type: 'required' }],
  }, 'ME@acme.com')!;
  assert.equal(e.key, 'm:series1');
  assert.equal(e.start, '2026-10-16T14:00:00.000Z');
  assert.equal(e.platform, 'teams');
  assert.deepEqual(e.attendees.map((a) => a.email), ['sam@acme.com']);
});

test('sorting drops past and all-day events and duplicates', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const mk = (id: string, start: string, end: string, allDay = false) => ({ key: id, id, provider: 'google' as const, title: id, start, end, allDay, meetingUrl: null, platform: null, attendees: [], location: null, recurring: false });
  const out = sortAndFilter([mk('b', '2026-10-16T15:00:00Z', '2026-10-16T16:00:00Z'), mk('past', '2026-10-16T09:00:00Z', '2026-10-16T10:00:00Z'), mk('a', '2026-10-16T13:00:00Z', '2026-10-16T14:00:00Z'), mk('a', '2026-10-16T13:00:00Z', '2026-10-16T14:00:00Z'), mk('holiday', '2026-10-16T00:00:00Z', '2026-10-17T00:00:00Z', true), null], now);
  assert.deepEqual(out.map((e) => e.id), ['a', 'b']);
});

test('project matching: explicit link wins, then longest whole-word name in title', () => {
  const projects = [{ id: 'p1', name: 'Riverside' }, { id: 'p2', name: 'Riverside Lofts' }, { id: 'p3', name: 'Ops' }];
  assert.deepEqual(matchProject({ key: 'g:1', title: 'Riverside Lofts – OAC' }, {}, projects), { project_id: 'p2', how: 'title' });
  assert.deepEqual(matchProject({ key: 'g:1', title: 'Anything' }, { 'g:1': 'p3' }, projects), { project_id: 'p3', how: 'linked' });
  assert.equal(matchProject({ key: 'g:2', title: 'Shopping trip' }, {}, [{ id: 'x', name: 'Ops' }, { id: 'y', name: 'hop' }]), null);
});

test('return URLs after provider sign-in are limited to our app', () => {
  assert.equal(isSafeReturn('murmur://upcoming', 'https://app.example.com', 'murmur'), true);
  assert.equal(isSafeReturn('https://app.example.com/upcoming', 'https://app.example.com', 'murmur'), true);
  assert.equal(isSafeReturn('https://evil.com/?x=https://app.example.com', 'https://app.example.com', 'murmur'), false);
  assert.equal(isSafeReturn('https://app.example.com.evil.com/', 'https://app.example.com', 'murmur'), false);
});
