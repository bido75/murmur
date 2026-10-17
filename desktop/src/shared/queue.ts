// The upload outbox, identical in spirit to the phone app's: create → segment(s) → finalize,
// kept in order per recording, retried with backoff. Pure functions over a plain array.

export type Base = { recordingId: string; attempts: number; nextAt: number; lastError?: string };
export type CreateOp = Base & {
  kind: 'create';
  title: string;
  template: string;
  projectId: string | null;
  consentMethod: string;
  consentAt: string | null;
  createdAt: string;
  video?: boolean;
};
export type SegmentOp = Base & { kind: 'segment'; idx: number; path: string; ext: string; durationMs: number; video?: boolean };
export type FinalizeOp = Base & { kind: 'finalize'; durationMs: number };
export type Op = CreateOp | SegmentOp | FinalizeOp;

/** Ops ready to run now: the first pending op of each recording, if its backoff has passed. */
export function runnable(queue: Op[], now: number): Op[] {
  const seen = new Set<string>();
  const out: Op[] = [];
  for (const op of queue) {
    if (seen.has(op.recordingId)) continue;
    seen.add(op.recordingId);
    if (op.nextAt <= now) out.push(op);
  }
  return out;
}

export function backoffMs(attempts: number): number {
  return Math.min(5000 * 2 ** attempts, 10 * 60 * 1000);
}

export function markFailed(op: Op, error: string, now: number): Op {
  const attempts = op.attempts + 1;
  return { ...op, attempts, lastError: error, nextAt: now + backoffMs(attempts) };
}

export function storagePath(userId: string, op: SegmentOp): string {
  return `${userId}/${op.recordingId}/seg-${String(op.idx).padStart(4, '0')}.${op.ext}`;
}

export function pendingSegments(queue: Op[]): number {
  return queue.filter((o) => o.kind === 'segment').length;
}
