// What to do when the app restarts with a recording that was interrupted.
// Pure: the decision is separated from the file and queue side effects so it can be
// tested (a recording the app cannot recover silently is the worst failure this
// product can have).

/** Persisted at the start of recording and updated as parts rotate. */
export type InterruptedSession = {
  recordingId: string;
  segIdx: number;
  doneMs: number;
  /** Where the part in progress was being written, if the OS left it readable. */
  currentUri: string | null;
  /** Transcribed on this phone (WAV parts, never uploaded). */
  local?: boolean;
};

/** What the recovery check found about the part in progress. */
export type InterruptedPart = {
  /** A part was being written. */
  present: boolean;
  /** The file exists and is large enough to be a real recording. */
  readable: boolean;
  /** The uri after it was moved into permanent storage, when recoverable. */
  keptUri: string | null;
};

export type RecoveryOp =
  | {
      kind: "segment";
      recordingId: string;
      idx: number;
      localUri: string;
      ext: string;
      durationMs: number;
    }
  | {
      kind: "local_segment";
      recordingId: string;
      idx: number;
      localUri: string;
      offsetMs: number;
      durationMs: number;
    }
  | { kind: "finalize"; recordingId: string; durationMs: number }
  | { kind: "local_finalize"; recordingId: string; durationMs: number };

export type RecoveryPlan = {
  /** The queue operations that restore the recording. Always at least a finalize. */
  ops: RecoveryOp[];
  /** The id the app should show as recovered, or null when there was no session. */
  recordingId: string | null;
};

/** The smallest file that can be a real recording (the header alone is discarded). */
export const MIN_RECOVERABLE_BYTES = 4096;

/**
 * Decide the recovery operations for an interrupted session.
 *
 * The part in progress is recovered only when it exists and is readable; earlier
 * parts were already enqueued as they rotated. Either way a finalize is queued, so
 * the recording completes with whatever was captured instead of hanging in
 * "recording" forever. A corrupted or missing part file is skipped, not fatal.
 */
export function recoveryPlan(
  session: InterruptedSession | null,
  part: InterruptedPart,
): RecoveryPlan {
  if (!session) return { ops: [], recordingId: null };
  const ext = session.local ? "wav" : "m4a";
  const ops: RecoveryPlan["ops"] = [];
  if (part.present && part.readable && part.keptUri) {
    ops.push(
      session.local
        ? {
            kind: "local_segment",
            recordingId: session.recordingId,
            idx: session.segIdx,
            localUri: part.keptUri,
            offsetMs: session.doneMs,
            durationMs: 0, // the server measures it during transcription
          }
        : {
            kind: "segment",
            recordingId: session.recordingId,
            idx: session.segIdx,
            localUri: part.keptUri,
            ext,
            durationMs: 0,
          },
    );
  }
  ops.push(
    session.local
      ? { kind: "local_finalize", recordingId: session.recordingId, durationMs: session.doneMs }
      : { kind: "finalize", recordingId: session.recordingId, durationMs: session.doneMs },
  );
  return { ops, recordingId: session.recordingId };
}