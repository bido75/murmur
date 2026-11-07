// The file side of the local log: append JSONL, rotate, never throw.
import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { logLine, logName, rotationPlan } from "./logger.ts";

function pathFor(dir: string, index: number): string {
  return join(dir, logName(index));
}

/** Write one event; any failure is swallowed by design. */
export function writeLogEvent(dir: string, kind: string, message: string): void {
  try {
    if (!existsSync(dir)) return; // logging is never worth creating trouble
    const file = pathFor(dir, 0);
    const bytes = existsSync(file) ? statSync(file).size : 0;
    if (rotationPlan(bytes).rotate) {
      // Drop the oldest, shift the rest down, start a new file.
      const { keepAfterRotate } = rotationPlan(bytes);
      const oldest = pathFor(dir, keepAfterRotate);
      if (existsSync(oldest)) unlinkSync(oldest);
      for (let i = keepAfterRotate - 1; i >= 0; i--) {
        const from = pathFor(dir, i);
        if (existsSync(from)) renameSync(from, pathFor(dir, i + 1));
      }
    }
    appendFileSync(file, logLine(kind, message));
  } catch {
    // A broken log must never break the app.
  }
}
