import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMicDiagnostics, sanitizeDevices } from './micDiagnostics.ts';

test('buildMicDiagnostics collects inputs, camera and remote-only flags', () => {
  const d = buildMicDiagnostics({
    devices: [
      { kind: 'videoinput', label: 'Brio 101' },
      { kind: 'audiooutput', label: 'Default - Remote Audio' },
      { kind: 'audiooutput', label: 'Communications - Remote Audio' },
      { kind: 'audioinput', label: 'Brio Mic' },
    ],
  });
  assert.deepEqual(d.audioInputs, [{ kind: 'audioinput', label: 'Brio Mic' }]);
  assert.equal(d.hasCamera, true);
  assert.equal(d.remoteOnly, true);
});

test('buildMicDiagnostics defaults unknown permission and no track', () => {
  const d = buildMicDiagnostics({ devices: [] });
  assert.equal(d.permission, 'unknown');
  assert.equal(d.trackState, 'none');
  assert.equal(d.level, null);
  assert.equal(d.error, null);
});

test('buildMicDiagnostics carries a sanitized error and selected input', () => {
  const d = buildMicDiagnostics({
    devices: [{ kind: 'audioinput', label: 'Mic' }],
    selectedInput: 'Mic',
    permission: 'denied',
    trackState: 'ended',
    error: { name: 'NotAllowedError', message: 'denied' },
  });
  assert.equal(d.selectedInput, 'Mic');
  assert.equal(d.permission, 'denied');
  assert.equal(d.trackState, 'ended');
  assert.equal(d.error?.name, 'NotAllowedError');
});

test('sanitizeDevices strips everything but kind and label', () => {
  // deno-lint-ignore no-explicit-any
  const raw = [{ kind: 'audioinput', label: 'Mic', deviceId: 'abc', groupId: 'g' }] as any[];
  const out = sanitizeDevices(raw);
  assert.deepEqual(out, [{ kind: 'audioinput', label: 'Mic' }]);
});