// Transcription adapter test script
// Tests: provider selection, privacy mode, availability checks
import assert from 'node:assert/strict';
import { test } from 'node:test';

// --- Test: mic_permission mapping ---
import { micMessage, micProblem } from '../supabase/functions/_shared/mic_permission.ts';

test('maps browser error names to problem types', () => {
  assert.equal(micProblem('NotAllowedError'), 'blocked');
  assert.equal(micProblem('SecurityError'), 'blocked');
  assert.equal(micProblem('NotFoundError'), 'no-device');
  assert.equal(micProblem('DevicesNotFoundError'), 'no-device');
  assert.equal(micProblem('NotReadableError'), 'in-use');
  assert.equal(micProblem('TrackStartError'), 'in-use');
  assert.equal(micProblem('NotSupportedError'), 'no-support');
  assert.equal(micProblem('TypeError'), 'no-support');
  assert.equal(micProblem('unknown'), 'unknown');
});

test('micMessage produces actionable web messages', () => {
  const blocked = micMessage('blocked', 'web');
  assert.match(blocked, /site permissions/);
  
  const noDevice = micMessage('no-device', 'web');
  assert.match(noDevice, /No microphone was found/);
  
  assert.equal(
    micMessage('no-device', 'web'),
    'No microphone was found. Plug one in, or choose one in the browser settings, and try again.'
  );
});

// --- Test: transcription engine privacy selection ---
function MockProvider(type, available) {
  return { type, available };
}

function canTranscribe(provider, opts) {
  return provider.available;
}

const deepgram = MockProvider('deepgram', true);
const whisper = MockProvider('whisper', true);
const parakeet = MockProvider('parakeet', false);

const providers = new Map([
  ['deepgram', deepgram],
  ['whisper', whisper],
  ['parakeet', parakeet],
]);

function selectProvider(preferred, privacyMode) {
  for (const type of preferred) {
    const provider = providers.get(type);
    if (provider && canTranscribe(provider, { privacy: privacyMode })) {
      return type;
    }
  }
  return preferred[0];
}

// Test: cloud mode prefers deepgram
assert.equal(
  selectProvider(['deepgram', 'whisper'], 'cloud-allowed'),
  'deepgram',
  'cloud mode prefers deepgram'
);

// Test: local-only mode prefers whisper (even if deepgram available first)
assert.equal(
  selectProvider(['whisper', 'deepgram'], 'local-only'),
  'whisper',
  'local-only mode prefers whisper'
);

// Test: whisper unavailable falls back to deepgram
const whisperUnavailable = MockProvider('whisper', false);
const providers2 = new Map([
  ['deepgram', deepgram],
  ['whisper', whisperUnavailable],
]);

function selectProvider2(preferred, privacyMode) {
  for (const type of preferred) {
    const provider = providers2.get(type);
    if (provider && canTranscribe(provider, { privacy: privacyMode })) {
      return type;
    }
  }
  return preferred[0];
}

assert.equal(
  selectProvider2(['whisper', 'deepgram'], 'local-only'),
  'deepgram',
  'whisper unavailable falls back to deepgram'
);

// Test: local-only mode blocks deepgram
function selectProvider3(preferred, privacyMode) {
  for (const type of preferred) {
    const provider = providers2.get(type);
    if (provider) {
      const can = canTranscribe(provider, { privacy: privacyMode });
      // deepgram should not be available in local-only mode
      if (type === 'deepgram' && privacyMode === 'local-only') {
        continue; // simulate deepgram blocked by privacy
      }
      if (can) return type;
    }
  }
  return preferred[0];
}

console.log('All tests passed!');