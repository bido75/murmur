// When to send the weekly digest. Pure; tested.

/** Monday between 8:00 and 8:59 in the user's time zone, and not sent in the last 6 days. */
export function isDigestTime(now: Date, timezone: string | null, lastSent: string | null): boolean {
  if (lastSent && now.getTime() - new Date(lastSent).getTime() < 6 * 86400_000) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  }
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return weekday === 'Mon' && hour === 8;
}
