import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLiveRecording, isLocallySaved, transition, type CapturePhase } from './captureState.ts';

test('the happy path reaches synced', () => {
  let s: CapturePhase = 'idle';
  for (const e of ['start', 'permission_granted', 'recording_started', 'stop_requested', 'finalized', 'sync_started', 'sync_completed'] as const) {
    s = transition(s, e);
  }
  assert.equal(s, 'synced');
});

test('permission denial and mic failure land in error', () => {
  assert.equal(transition('requesting_permission', 'permission_denied'), 'error');
  assert.equal(transition('acquiring', 'mic_failed'), 'error');
});

test('pause/resume stays within the recording states', () => {
  assert.equal(transition('recording', 'paused'), 'paused');
  assert.equal(transition('paused', 'resumed'), 'recording');
});

test('an illegal transition leaves the state unchanged', () => {
  assert.equal(transition('idle', 'stop_requested'), 'idle');
  assert.equal(transition('synced', 'paused'), 'synced');
});

test('error resets to idle', () => {
  assert.equal(transition('error', 'reset'), 'idle');
});

test('isLiveRecording and isLocallySaved classify phases', () => {
  assert.equal(isLiveRecording('recording'), true);
  assert.equal(isLiveRecording('paused'), true);
  assert.equal(isLiveRecording('idle'), false);
  assert.equal(isLocallySaved('locally_saved'), true);
  assert.equal(isLocallySaved('sync_pending'), true);
  assert.equal(isLocallySaved('recording'), false);
});