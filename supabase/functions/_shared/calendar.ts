// Calendar event normalization and matching. Pure, unit-tested.

export type CalProvider = 'google' | 'microsoft';
export type Platform = 'zoom' | 'meet' | 'teams' | 'webex' | null;

export type CalendarEvent = {
  key: string; // stable across a recurring series, used to link the meeting to a project
  id: string;
  provider: CalProvider;
  title: string;
  start: string; // ISO UTC
  end: string;
  allDay: boolean;
  meetingUrl: string | null;
  platform: Platform;
  attendees: { name: string | null; email: string }[];
  location: string | null;
  recurring: boolean;
};

const LINK_PATTERNS: [Platform, RegExp][] = [
  ['zoom', /https:\/\/[\w.-]*zoom\.us\/(j|my|w)\/[^\s"'<>)]+/i],
  ['meet', /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s"'<>)]*/i],
  ['teams', /https:\/\/teams\.(microsoft|live)\.com\/(l\/meetup-join|meet)\/[^\s"'<>)]+/i],
  ['webex', /https:\/\/[\w.-]*webex\.com\/[^\s"'<>)]+/i],
];

/** First video-meeting link found in any of the given texts. */
export function detectMeetingLink(...texts: (string | null | undefined)[]): { url: string; platform: Platform } | null {
  for (const text of texts) {
    if (!text) continue;
    for (const [platform, re] of LINK_PATTERNS) {
      const m = text.match(re);
      if (m) return { url: m[0], platform };
    }
  }
  return null;
}

type GoogleEvent = {
  id: string;
  status?: string;
  recurringEventId?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  location?: string;
  description?: string;
};

export function normalizeGoogle(e: GoogleEvent): CalendarEvent | null {
  if (e.status === 'cancelled' || !e.start) return null;
  const allDay = !e.start.dateTime;
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  const link = detectMeetingLink(video, e.hangoutLink, e.location, e.description);
  return {
    key: `g:${e.recurringEventId ?? e.id}`,
    id: e.id,
    provider: 'google',
    title: e.summary?.trim() || '(No title)',
    start: toIso(e.start.dateTime ?? e.start.date!),
    end: toIso(e.end?.dateTime ?? e.end?.date ?? e.start.dateTime ?? e.start.date!),
    allDay,
    meetingUrl: link?.url ?? null,
    platform: link?.platform ?? null,
    attendees: (e.attendees ?? [])
      .filter((a) => a.email && !a.self && !a.resource)
      .map((a) => ({ name: a.displayName ?? null, email: a.email!.toLowerCase() })),
    location: e.location ?? null,
    recurring: Boolean(e.recurringEventId),
  };
}

type GraphEvent = {
  id: string;
  subject?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  seriesMasterId?: string | null;
  type?: string;
  start?: { dateTime: string; timeZone?: string };
  end?: { dateTime: string; timeZone?: string };
  attendees?: { emailAddress?: { name?: string; address?: string }; type?: string }[];
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  location?: { displayName?: string };
  bodyPreview?: string;
};

/** Graph calendarView returns times in the zone asked for via `Prefer: outlook.timezone="UTC"`. */
export function normalizeGraph(e: GraphEvent, selfEmail?: string | null): CalendarEvent | null {
  if (e.isCancelled || !e.start) return null;
  const link = detectMeetingLink(e.onlineMeeting?.joinUrl, e.onlineMeetingUrl, e.location?.displayName, e.bodyPreview);
  const me = selfEmail?.toLowerCase();
  return {
    key: `m:${e.seriesMasterId ?? e.id}`,
    id: e.id,
    provider: 'microsoft',
    title: e.subject?.trim() || '(No title)',
    start: graphTime(e.start.dateTime),
    end: graphTime(e.end?.dateTime ?? e.start.dateTime),
    allDay: Boolean(e.isAllDay),
    meetingUrl: link?.url ?? null,
    platform: link?.platform ?? null,
    attendees: (e.attendees ?? [])
      .filter((a) => a.emailAddress?.address && a.type !== 'resource' && a.emailAddress.address.toLowerCase() !== me)
      .map((a) => ({ name: a.emailAddress!.name ?? null, email: a.emailAddress!.address!.toLowerCase() })),
    location: e.location?.displayName || null,
    recurring: Boolean(e.seriesMasterId) || e.type === 'occurrence',
  };
}

function toIso(s: string): string {
  // All-day dates ("2026-10-16") become midnight UTC.
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : new Date(s).toISOString();
}

function graphTime(s: string): string {
  // Graph returns "2026-10-16T14:00:00.0000000" (no zone) when UTC is requested.
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`).toISOString();
}

/** Upcoming, timed meetings first; all-day items are rarely meetings. */
export function sortAndFilter(events: (CalendarEvent | null)[], now = new Date()): CalendarEvent[] {
  const seen = new Set<string>();
  return events
    .filter((e): e is CalendarEvent => !!e && !e.allDay && new Date(e.end).getTime() > now.getTime())
    .filter((e) => {
      const k = `${e.provider}:${e.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Which project a meeting belongs to: an explicit link the user made wins; otherwise a
 * project whose name appears in the meeting title (longest name first, whole words).
 */
export function matchProject(
  event: Pick<CalendarEvent, 'key' | 'title'>,
  links: Record<string, string>,
  projects: { id: string; name: string }[],
): { project_id: string; how: 'linked' | 'title' } | null {
  if (links[event.key]) return { project_id: links[event.key], how: 'linked' };
  const title = ` ${event.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const byLength = [...projects].sort((a, b) => b.name.length - a.name.length);
  for (const p of byLength) {
    const name = p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (name.length >= 3 && title.includes(` ${name} `)) return { project_id: p.id, how: 'title' };
  }
  return null;
}

/** Only send the user back to our own app after the provider's sign-in. */
export function isSafeReturn(returnTo: string, appUrl: string, appScheme: string): boolean {
  if (appScheme && returnTo.startsWith(`${appScheme}://`)) return true;
  if (!appUrl) return false;
  try {
    const r = new URL(returnTo);
    const a = new URL(appUrl);
    return r.origin === a.origin;
  } catch {
    return false;
  }
}
