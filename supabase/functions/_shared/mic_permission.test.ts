import { test } from 'node:test';
import assert from 'node:assert/strict';
import { micMessage, micProblem, type MicProblem } from './mic_permission.ts';

test('the microphone problem is read from what the browser said', () => {
  assert.equal(micProblem('NotAllowedError'), 'blocked');
  assert.equal(micProblem('SecurityError'), 'blocked');
  assert.equal(micProblem('NotFoundError'), 'no-device');
  assert.equal(micProblem('DevicesNotFoundError'), 'no-device');
  assert.equal(micProblem('NotReadableError'), 'in-use');
  assert.equal(micProblem('TrackStartError'), 'in-use');
  assert.equal(micProblem('NotSupportedError'), 'no-support');
  assert.equal(micProblem('TypeError'), 'no-support');
  assert.equal(micProblem('something else'), 'unknown');
  assert.equal(micProblem(null), 'unknown');
  assert.equal(micProblem(undefined), 'unknown');
  assert.equal(micProblem('notallowederror'), 'blocked', 'the name may come in any case');
});

test('a browser is told where the microphone is allowed, a phone is told about Settings', () => {
  assert.match(micMessage('blocked', 'web'), /site permissions/);
  assert.match(micMessage('blocked', 'native'), /Settings/);
  assert.match(micMessage('no-device', 'web'), /No microphone/);
  assert.match(micMessage('no-device', 'native'), /No microphone/);
  assert.match(micMessage('in-use', 'native'), /Another app/);
  assert.match(micMessage('in-use', 'web'), /Another app/);
  assert.match(micMessage('no-support', 'web'), /browser cannot record/);
  // Every case says something the user can act on.
  const all: MicProblem[] = ['blocked', 'no-device', 'in-use', 'no-support', 'unknown'];
  for (const p of all) {
    assert.ok(micMessage(p, 'web').length > 25, `${p} (web) needs a real message`);
    assert.ok(micMessage(p, 'native').length > 25, `${p} (native) needs a real message`);
  }
});
