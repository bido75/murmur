import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL,
  SPEECH_MODELS,
  modelById,
  modelFileName,
  modelState,
  modelUsable,
  modelStateMessage,
  progressPercent,
  verifyModel,
  type ModelStatus,
} from './transcription_model.ts';

function status(over: Partial<ModelStatus> = {}): ModelStatus {
  return {
    spec: DEFAULT_MODEL,
    present: true,
    sizeBytes: DEFAULT_MODEL.sizeBytes,
    installedVersion: DEFAULT_MODEL.version,
    verifiedVersion: DEFAULT_MODEL.version,
    ...over,
  };
}

test('the published model has a checksum and a size', () => {
  assert.ok(SPEECH_MODELS.length > 0);
  for (const m of SPEECH_MODELS) {
    assert.match(m.sha256, /^[0-9a-f]{64}$/, `${m.id} needs a sha256`);
    assert.ok(m.sizeBytes > 0, `${m.id} needs a size`);
    assert.ok(m.sizeMb > 0, `${m.id} needs a size for the user`);
    assert.match(m.url, /^https:\/\//, `${m.id} must be fetched over https`);
  }
});

test('a model is found by id, and an unknown id falls back to the default', () => {
  assert.equal(modelById('whisper-base-q5_1').id, DEFAULT_MODEL.id);
  assert.equal(modelById('nope').id, DEFAULT_MODEL.id);
  assert.equal(modelById(null).id, DEFAULT_MODEL.id);
  assert.equal(modelById(undefined).id, DEFAULT_MODEL.id);
});

test('the file name carries the version, so two versions can sit side by side', () => {
  const name = modelFileName(DEFAULT_MODEL);
  assert.ok(name.includes(DEFAULT_MODEL.id));
  assert.ok(name.includes(DEFAULT_MODEL.version));
});

test('a model that is not there is missing', () => {
  assert.equal(modelState(status({ present: false, sizeBytes: 0 })), 'missing');
  assert.equal(modelState(status({ present: true, sizeBytes: 0 })), 'missing');
});

test('a model of the wrong size is corrupt, not ready', () => {
  const short = status({ sizeBytes: DEFAULT_MODEL.sizeBytes - 1000 });
  assert.equal(modelState(short), 'corrupt');
  const usable = modelUsable(short);
  assert.equal(usable.usable, false);
  assert.match(usable.reason ?? '', /damaged/);
});

test('a model of the right size that was never checked is verified before use', () => {
  const unchecked = status({ verifiedVersion: null });
  assert.equal(modelState(unchecked), 'verifying');
  const usable = modelUsable(unchecked);
  assert.equal(usable.usable, true);
  assert.equal(usable.needsCheck, true);
});

test('a checked model of the current version is ready', () => {
  assert.equal(modelState(status()), 'ready');
  const usable = modelUsable(status());
  assert.equal(usable.usable, true);
  assert.equal(usable.needsCheck, false);
});

test('an older build is outdated until the newer one is downloaded', () => {
  const old = status({
    installedVersion: '20230101',
    verifiedVersion: '20230101',
  });
  assert.equal(modelState(old), 'outdated');
  const usable = modelUsable(old);
  assert.equal(usable.usable, false);
  assert.match(usable.reason ?? '', /out of date/);
});

test('a download is checked against the size first, then the checksum', () => {
  const short = new Uint8Array(10);
  const result = verifyModel(DEFAULT_MODEL, short);
  assert.equal(result.ok, false);
  assert.match(
    result.ok ? '' : result.reason,
    /did not finish/,
    'a short download is said plainly',
  );
});

test('a file of the right size but the wrong contents is refused', () => {
  // The right length, the wrong bytes.
  const wrong = new Uint8Array(DEFAULT_MODEL.sizeBytes).fill(0x41);
  const result = verifyModel(DEFAULT_MODEL, wrong);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /not the one we published/);
});

test('the published checksum matches the published size', () => {
  // Guards against a typo in either field being taken as gospel.
  assert.equal(
    DEFAULT_MODEL.sizeBytes,
    59707625,
    'the published size of ggml-base-q5_1.bin',
  );
  assert.equal(
    DEFAULT_MODEL.sha256,
    '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
    'the published sha256 of ggml-base-q5_1.bin',
  );
});

test('progress is a whole percentage that never goes past the end', () => {
  assert.equal(progressPercent(0, 100), 0);
  assert.equal(progressPercent(50, 100), 50);
  assert.equal(progressPercent(100, 100), 100);
  assert.equal(progressPercent(150, 100), 100);
  assert.equal(progressPercent(-5, 100), 0);
  assert.equal(progressPercent(10, 0), 0, 'an unknown total is 0%');
});

test('every state has a message the user can act on', () => {
  const states = [
    'missing',
    'downloading',
    'verifying',
    'ready',
    'corrupt',
    'outdated',
  ] as const;
  for (const s of states) {
    const msg = modelStateMessage(s, DEFAULT_MODEL);
    assert.ok(msg.length > 10, `${s} needs a real message`);
  }
});
