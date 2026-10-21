// When a meeting bot can be held for a meeting, and when it has to join straight away.
// Pure rules with no imports, so the app and the server use the same ones
// (see src/lib/shared.ts).

/**
 * How much notice Recall needs to hold a bot for a meeting. A bot booked for later is
 * reserved; one sent at short notice comes from a pool that is sometimes empty, and the
 * request then fails with a 507. So a meeting that starts soon is joined straight away
 * instead, and the user is told the host may have to let it in.
 */
export const SCHEDULED_LEAD_MS = 10 * 60_000;

/** True when the bot can be held for that meeting, so it is sure to join on time. */
export function scheduledInTime(joinAt: string | null, now = Date.now()): boolean {
  if (!joinAt) return false;
  const at = new Date(joinAt).getTime();
  return Number.isFinite(at) && at >= now + SCHEDULED_LEAD_MS;
}
