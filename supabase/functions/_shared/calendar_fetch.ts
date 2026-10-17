// Fetching upcoming events from connected calendars (Deno). Used by the calendar function and
// by the automatic notetaker. Refresh tokens never leave the server.
import { adminClient } from './services.ts';
import { normalizeGoogle, normalizeGraph, type CalendarEvent, type CalProvider } from './calendar.ts';

export const PROVIDERS: Record<CalProvider, { auth: string; token: string; scope: string; idEnv: string; secretEnv: string }> = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
    idEnv: 'GOOGLE_CLIENT_ID',
    secretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  microsoft: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid email offline_access User.Read Calendars.Read',
    idEnv: 'MICROSOFT_CLIENT_ID',
    secretEnv: 'MICROSOFT_CLIENT_SECRET',
  },
};

export const creds = (p: CalProvider) => ({ id: Deno.env.get(PROVIDERS[p].idEnv) ?? '', secret: Deno.env.get(PROVIDERS[p].secretEnv) ?? '' });

export async function accessToken(provider: CalProvider, refreshToken: string, userId: string): Promise<string | null> {
  const c = creds(provider);
  const res = await fetch(PROVIDERS[provider].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.id, client_secret: c.secret, scope: PROVIDERS[provider].scope }),
  });
  const tok = await res.json();
  if (!res.ok) {
    console.error('calendar refresh failed', provider, res.status, tok?.error);
    return null;
  }
  // Microsoft rotates refresh tokens; keep the newest.
  if (tok.refresh_token && tok.refresh_token !== refreshToken) {
    await adminClient().from('calendar_connections').update({ refresh_token: tok.refresh_token }).eq('user_id', userId).eq('provider', provider);
  }
  return tok.access_token;
}


/** Upcoming events (raw, normalized) from every calendar the user connected. */
export async function fetchEvents(userId: string, now: Date, until: Date): Promise<{ events: (CalendarEvent | null)[]; problems: string[]; conns: { provider: CalProvider; account_email: string | null }[] }> {
  const db = adminClient();
  const { data: conns } = await db.from('calendar_connections').select('provider, refresh_token, account_email').eq('user_id', userId);
  if (!conns?.length) return { events: [], problems: [], conns: [] };

  const all: (CalendarEvent | null)[] = [];
  const problems: string[] = [];
  for (const conn of conns as { provider: CalProvider; refresh_token: string; account_email: string | null }[]) {
    if (!creds(conn.provider).id) continue;
    const at = await accessToken(conn.provider, conn.refresh_token, userId);
    if (!at) {
      problems.push(conn.provider);
      continue;
    }
    if (conn.provider === 'google') {
      const u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      u.search = new URLSearchParams({ timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' }).toString();
      const r = await fetch(u, { headers: { Authorization: `Bearer ${at}` } });
      if (!r.ok) { problems.push('google'); continue; }
      all.push(...((await r.json()).items ?? []).map(normalizeGoogle));
    } else {
      const u = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
      u.search = new URLSearchParams({
        startDateTime: now.toISOString(),
        endDateTime: until.toISOString(),
        $top: '50',
        $orderby: 'start/dateTime',
        $select: 'id,subject,start,end,isAllDay,isCancelled,seriesMasterId,type,attendees,onlineMeeting,onlineMeetingUrl,location,bodyPreview',
      }).toString();
      const r = await fetch(u, { headers: { Authorization: `Bearer ${at}`, Prefer: 'outlook.timezone="UTC"' } });
      if (!r.ok) { problems.push('microsoft'); continue; }
      all.push(...((await r.json()).value ?? []).map((e: Parameters<typeof normalizeGraph>[0]) => normalizeGraph(e, conn.account_email)));
    }
  }

  return { events: all, problems, conns: (conns ?? []) as { provider: CalProvider; account_email: string | null }[] };
}
