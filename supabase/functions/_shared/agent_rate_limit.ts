// Pure rate limiting for the agent: a sliding-window decision over event timestamps.
// The endpoint feeds it the created_at of the user's recent runs; this module only
// computes the decision (testable, deterministic).
export type RateLimitDecision = { allowed: boolean; count: number; limit: number; retryAfterMs: number };

/** Timestamps inside the sliding window, and the oldest one (for retry-after). */
export function slidingWindow(events: number[], now: number, windowMs: number): { inWindow: number; oldest: number | null } {
  const cutoff = now - windowMs;
  let inWindow = 0;
  let oldest: number | null = null;
  for (const t of events) {
    if (t > cutoff) {
      inWindow++;
      if (oldest === null || t < oldest) oldest = t;
    }
  }
  return { inWindow, oldest };
}

export function allow(events: number[], now: number, opts: { max: number; windowMs: number }): RateLimitDecision {
  const { inWindow, oldest } = slidingWindow(events, now, opts.windowMs);
  const allowed = inWindow < opts.max;
  const retryAfterMs = allowed ? 0 : Math.max(0, (oldest ?? now) + opts.windowMs - now);
  return { allowed, count: inWindow, limit: opts.max, retryAfterMs };
}
