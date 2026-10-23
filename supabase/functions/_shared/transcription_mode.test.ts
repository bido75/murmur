import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSCRIPTION_MODES,
  chooseProvider,
  cloudAllowed,
  describeChoice,
  providerUsable,
  type ModeContext,
} from './transcription_mode.ts';

function ctx(over: Partial<ModeContext> = {}): ModeContext {
  return {
    mode: 'auto',
    localReady: true,
    cloudReady: true,
    localOnly: false,
    preferLocal: false,
    ...over,
  };
}

test('Auto uses the cloud when both work and local is not preferred', () => {
  assert.equal(chooseProvider(ctx()), 'cloud');
});

test('Auto uses the device when the user prefers it', () => {
  assert.equal(chooseProvider(ctx({ preferLocal: true })), 'local');
});

test('Auto uses the device when there is no cloud', () => {
  assert.equal(chooseProvider(ctx({ cloudReady: false })), 'local');
});

test('Auto uses the cloud when there is no local model', () => {
  assert.equal(chooseProvider(ctx({ localReady: false })), 'cloud');
});

test('a chosen mode is honoured', () => {
  assert.equal(chooseProvider(ctx({ mode: 'local' })), 'local');
  assert.equal(chooseProvider(ctx({ mode: 'cloud' })), 'cloud');
});

test('local-only privacy wins over every other setting', () => {
  // Even with an explicit "Cloud" mode, nothing may be uploaded.
  assert.equal(
    chooseProvider(ctx({ mode: 'cloud', localOnly: true })),
    'local',
    'an explicit cloud mode must not upload when the user asked for local-only',
  );
  assert.equal(
    chooseProvider(ctx({ mode: 'auto', localOnly: true })),
    'local',
  );
  assert.equal(
    chooseProvider(ctx({ mode: 'local', localOnly: true })),
    'local',
  );
});

test('local-only privacy is never overridden by the cloud being ready', () => {
  const c = ctx({ mode: 'cloud', localOnly: true, cloudReady: true });
  assert.equal(cloudAllowed(c), false);
  assert.equal(cloudAllowed(ctx({ mode: 'auto' })), true);
  assert.equal(cloudAllowed(ctx({ mode: 'cloud' })), true);
  assert.equal(cloudAllowed(ctx({ mode: 'local' })), false);
});

test('a choice is only usable when its engine can actually run', () => {
  assert.equal(providerUsable('local', ctx({ localReady: true })), true);
  assert.equal(providerUsable('local', ctx({ localReady: false })), false);
  assert.equal(providerUsable('cloud', ctx({ cloudReady: true })), true);
  assert.equal(providerUsable('cloud', ctx({ cloudReady: false })), false);
});

test('the user is told what leaves the device', () => {
  // Local: only the words go, the audio stays.
  const local = describeChoice('local', ctx({ localReady: true }));
  assert.equal(local.leaves, 'text');
  assert.match(local.summary, /never the audio/i);
  assert.match(local.detail, /never leaves the device/i);

  // Cloud: the audio goes.
  const cloud = describeChoice('cloud', ctx({ cloudReady: true }));
  assert.equal(cloud.leaves, 'audio');
  assert.match(cloud.summary, /cloud/i);

  // Local with no model: nothing leaves, and it says what to do.
  const missing = describeChoice('local', ctx({ localReady: false }));
  assert.equal(missing.leaves, 'nothing');
  assert.match(missing.detail, /Download the speech model/);

  // Cloud with no network: nothing leaves.
  const offline = describeChoice('cloud', ctx({ cloudReady: false }));
  assert.equal(offline.leaves, 'nothing');
  assert.match(offline.detail, /no connection/i);
});

test('every mode has a name and an explanation', () => {
  assert.equal(TRANSCRIPTION_MODES.length, 3);
  const modes = TRANSCRIPTION_MODES.map((m) => m.mode);
  assert.deepEqual(modes, ['cloud', 'local', 'auto']);
  for (const m of TRANSCRIPTION_MODES) {
    assert.ok(m.label.length > 0);
    assert.ok(m.detail.length > 20, `${m.mode} needs a real explanation`);
  }
});
