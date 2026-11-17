// Shared recording state model: an explicit, testable state machine for the capture and
// synchronization lifecycle. Capture drives up to `locally_saved`; the upload outbox
// drives `sync_pending`/`synced`. Pure — no browser or platform globals.

export type CapturePhase =
  | 'idle'
  | 'requesting_permission'
  | 'acquiring'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'locally_saved'
  | 'sync_pending'
  | 'synced'
  | 'error';

export type CaptureEvent =
  | 'start'
  | 'permission_granted'
  | 'permission_denied'
  | 'mic_opened'
  | 'mic_failed'
  | 'recording_started'
  | 'paused'
  | 'resumed'
  | 'stop_requested'
  | 'finalized'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'reset';

/** Phases in which audio is actively being captured. */
export function isLiveRecording(phase: CapturePhase): boolean {
  return phase === 'recording' || phase === 'paused';
}

/** Phases in which the recording has been durably captured locally. */
export function isLocallySaved(phase: CapturePhase): boolean {
  return phase === 'locally_saved' || phase === 'sync_pending' || phase === 'synced';
}

/**
 * The single transition table. Anything not listed is an illegal transition and returns
 * the current phase unchanged (callers should surface an error rather than guess).
 */
const TRANSITIONS: Record<CapturePhase, Partial<Record<CaptureEvent, CapturePhase>>> = {
  idle: { start: 'requesting_permission', reset: 'idle' },
  requesting_permission: { permission_granted: 'acquiring', permission_denied: 'error', reset: 'idle' },
  acquiring: { mic_opened: 'acquiring', recording_started: 'recording', mic_failed: 'error', reset: 'idle' },
  recording: { paused: 'paused', stop_requested: 'finalizing' },
  paused: { resumed: 'recording', stop_requested: 'finalizing' },
  finalizing: { finalized: 'locally_saved' },
  locally_saved: { sync_started: 'sync_pending', reset: 'idle' },
  sync_pending: { sync_completed: 'synced', sync_failed: 'error' },
  synced: { reset: 'idle' },
  error: { reset: 'idle' },
};

export function transition(state: CapturePhase, event: CaptureEvent): CapturePhase {
  return TRANSITIONS[state]?.[event] ?? state;
}
