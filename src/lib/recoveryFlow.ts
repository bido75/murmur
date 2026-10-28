// The recovery orchestration for an interrupted recording, separated from the
// platform edges (async storage, file system, upload queue) so it can be driven
// end to end in tests with fault injection. recorder.ts wires the production
// ports: AsyncStorage holds the session marker, expo-file-system probes the
// part in progress, and the outbox carries the recovery ops.
//
// Re-running recovery after a crash mid-recovery is safe: an op already queued
// by an earlier attempt is not queued again (the queue is checked first), so a
// duplicate recovery cannot double-upload a part or double-finalize.
import {
  recoveryPlan,
  type InterruptedPart,
  type InterruptedSession,
  type RecoveryOp,
} from "./recoveryPlan";

export type RecoveryPorts = {
  /** The persisted session marker (raw JSON), or null when there is none. */
  loadSession(): Promise<string | null>;
  /** Inspect (and when readable, move) the part that was in progress. */
  probePart(session: InterruptedSession): Promise<InterruptedPart>;
  /** What is already waiting in the outbox, for the idempotence check. */
  pendingOps(): Promise<{ kind: string; recordingId: string; idx?: number }[]>;
  enqueueOp(op: RecoveryOp): Promise<void>;
  clearSession(): Promise<void>;
};

function opKey(op: { kind: string; recordingId: string; idx?: number }): string {
  return `${op.kind}:${op.recordingId}:${op.idx ?? ""}`;
}

export async function recoverSession(
  ports: RecoveryPorts,
): Promise<string | null> {
  const raw = await ports.loadSession();
  if (!raw) return null;
  const a = JSON.parse(raw) as InterruptedSession;
  let part: InterruptedPart = { present: false, readable: false, keptUri: null };
  try {
    part = await ports.probePart(a);
  } catch {
    // The partial file was unreadable; earlier segments are still safe.
    part = { present: Boolean(a.currentUri), readable: false, keptUri: null };
  }
  const plan = recoveryPlan(a, part);
  const queued = new Set((await ports.pendingOps()).map(opKey));
  for (const op of plan.ops) {
    if (queued.has(opKey(op))) continue;
    await ports.enqueueOp(op);
  }
  await ports.clearSession();
  return plan.recordingId;
}
