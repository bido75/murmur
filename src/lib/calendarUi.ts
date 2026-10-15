import * as Linking from 'expo-linking';
import { isWeb } from './dialog';
import type { CalendarEvent } from './types';

/** Where the provider sign-in should send the user back to. */
export function calendarReturnUrl(): string {
  return isWeb ? `${window.location.origin}/upcoming` : Linking.createURL('upcoming');
}

export function timeRange(e: Pick<CalendarEvent, 'start' | 'end'>): string {
  const s = new Date(e.start);
  const end = new Date(e.end);
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${t(s)}–${t(end)}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Route params for the brief screen (kept small and string-only). */
export function briefParams(e: CalendarEvent): Record<string, string> {
  return {
    key: e.key,
    title: e.title,
    start: e.start,
    end: e.end,
    url: e.meetingUrl ?? '',
    who: e.attendees.slice(0, 12).map((a) => a.name || a.email).join(', '),
    projectId: e.match?.project_id ?? '',
  };
}
