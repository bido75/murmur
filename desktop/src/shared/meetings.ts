// Meeting detection from the OS process list. Pure, unit-tested.
// Conservative on purpose: a false "meeting detected" prompt is more annoying than a missed one.

export type MeetingApp = 'zoom' | 'teams' | 'webex';
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
