// Meeting detection from the OS process list. Pure, unit-tested.
// Conservative on purpose: a false "meeting detected" prompt is more annoying than a missed one.

export type MeetingApp = 'zoom' | 'teams' | 'webex' | 'meet';

export const MEETING_LABELS: Record<MeetingApp, string> = { zoom: 'Zoom', teams: 'Teams', webex: 'Webex', meet: 'Google Meet' };
export type ProcessInfo = { name: string; title?: string };

/** Parse `ps -axo comm=` (macOS) into process names. */
export function parsePs(output: string): ProcessInfo[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((path) => ({ name: path.split('/').pop() ?? path }));
}

/** Parse `tasklist /v /fo csv /nh` (Windows): "Image Name","PID",...,"Window Title". */
export function parseTasklist(output: string): ProcessInfo[] {
  const rows: ProcessInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const cols = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
    if (cols.length >= 2) rows.push({ name: cols[0], title: cols[cols.length - 1] });
  }
  return rows;
}

/**
 * Which meeting is in progress, if any.
 * - Zoom runs a separate "CptHost" process only while a meeting is active (macOS and Windows).
 * - On Windows, Zoom and Teams meeting windows have recognisable titles.
 * - Webex's meeting process is "atmgr".
 */
export function detectMeeting(processes: ProcessInfo[]): MeetingApp | null {
  const names = new Set(processes.map((p) => p.name.toLowerCase().replace(/\.exe$/, '')));
  if (names.has('cpthost')) return 'zoom';
  for (const p of processes) {
    const name = p.name.toLowerCase();
    const title = (p.title ?? '').trim();
    if (!title || title === 'N/A') continue;
    if (name.startsWith('zoom') && /^zoom meeting\b/i.test(title)) return 'zoom';
    if ((name.includes('teams') || name === 'msedgewebview2.exe') && /\bmeeting\b.*\|\s*microsoft teams$/i.test(title)) return 'teams';
  }
  if (names.has('atmgr')) return 'webex';
  return null;
}

/** Only prompt once per meeting: fire when a meeting starts, reset when it ends. */
export function shouldPrompt(prev: MeetingApp | null, now: MeetingApp | null, recording: boolean): boolean {
  return !recording && now !== null && prev === null;
}

/**
 * Meetings in a browser tab, from window titles (the browser shows the active tab's title).
 * - Google Meet: "Meet - abc-defg-hij" (the meeting code; the lobby and home page don't match)
 * - Teams on the web: "… | Meeting | Microsoft Teams" / "Meeting with … | Microsoft Teams"
 * - Zoom web client and Webex web: "Zoom Meeting", "Webex Meeting"/"… - Webex"
 */
export function detectBrowserMeeting(titles: string[]): MeetingApp | null {
  for (const raw of titles) {
    const t = raw.trim();
    if (/(^|\s)Meet\s[-–]\s[a-z]{3}-[a-z]{4}-[a-z]{3}\b/.test(t)) return 'meet';
    if (/\bmeeting\b.*\|\s*microsoft teams\b/i.test(t)) return 'teams';
    if (/^zoom meeting\b/i.test(t) || /\bzoom meeting\s[-–]/i.test(t)) return 'zoom';
    if (/^webex meeting\b/i.test(t) || /\bmeeting\b.*[-–]\s*webex\b/i.test(t)) return 'webex';
  }
  return null;
}
