// A small local log for crashes and unexpected errors.
//
// It exists so a user can send a file when something went wrong, and so the release
// verification has something real to read. Three rules keep it trustworthy:
//  - no recording content, no transcript text, no tokens - only error messages;
//  - it never grows without bound: three files of at most 512 KB, rotated;
//  - a logging failure must never break the app, so every write is guarded.
export const MAX_LOG_BYTES = 512 * 1024;
export const LOG_KEEP = 3;

/** The rotation decision, pure so it can be tested without a filesystem. */
export function rotationPlan(currentBytes: number, maxBytes = MAX_LOG_BYTES, keep = LOG_KEEP): {
  rotate: boolean;
  /** How many old files to keep after rotating (one less than the total slots). */
  keepAfterRotate: number;
} {
  return { rotate: currentBytes >= maxBytes, keepAfterRotate: keep - 1 };
}

/** app.log, app.1.log, app.2.log - the newest has no number. */
export function logName(index: number): string {
  return index === 0 ? "app.log" : `app.${index}.log`;
}

/** One structured line; the message is truncated so one bad error cannot fill a file. */
export function logLine(kind: string, message: string, at = new Date().toISOString()): string {
  const clean = String(message ?? "").replace(/\s+/g, " ").slice(0, 500);
  return `${JSON.stringify({ at, kind, message: clean })}\n`;
}
