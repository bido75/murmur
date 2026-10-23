import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPEECH_MODEL,
  SPEECH_MODELS,
  bundleProgressPercent,
  bundleReady,
  bundleSizeMb,
  fileState,
  modelFolderName,
  modelMessage,
  progressPercent,
  speechModelById,
  verifySpeechFile,
  type InstalledFile,
} from './speechModels.ts';

function installed(over: Partial<InstalledFile> = {}): InstalledFile {
  return {
    name: 'encoder.onnx',
    present: true,
    sizeBytes: DEFAULT_SPEECH_MODEL.files[0].sizeBytes,
    verifiedVersion: DEFAULT_SPEECH_MODEL.version,
    ...over,
  };
}

test('every published model file has a checksum, a size and an https address', () => {
  assert.ok(SPEECH_MODELS.length > 0);
  for (const m of SPEECH_MODELS) {
    assert.ok(m.files.length > 0, `${m.id} needs files`);
    for (const f of m.files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/, `${m.id}/${f.name} needs a sha256`);
      assert.ok(f.sizeBytes > 0, `${m.id}/${f.name} needs a size`);
      assert.match(f.url, /^https:\/\//, `${m.id}/${f.name} must be fetched over https`);
    }
  }
});

test('the published sizes and checksums are the ones the host publishes', () => {
  // Guards against a typo in either field being taken as gospel.
  const encoder = DEFAULT_SPEECH_MODEL.files.find((f) => f.name === 'encoder.onnx');
  assert.ok(encoder);
  assert.equal(encoder.sizeBytes, 653979575);
  assert.equal(
    encoder.sha256,
    '4cbf4dfc2bd2c4a565609ef373925ad09cb55250c19d7e25f7893be49d5cb5f7',
  );
  const tokens = DEFAULT_SPEECH_MODEL.files.find((f) => f.name === 'tokens.txt');
  assert.ok(tokens);
  assert.equal(tokens.sizeBytes, 93939);
});

test('a model is found by id, and an unknown id falls back to the default', () => {
  assert.equal(speechModelById(DEFAULT_SPEECH_MODEL.id).id, DEFAULT_SPEECH_MODEL.id);
  assert.equal(speechModelById('nope').id, DEFAULT_SPEECH_MODEL.id);
  assert.equal(speechModelById(null).id, DEFAULT_SPEECH_MODEL.id);
});

test('the folder name carries the version, so two builds can sit side by side', () => {
  const name = modelFolderName(DEFAULT_SPEECH_MODEL);
  assert.ok(name.includes(DEFAULT_SPEECH_MODEL.id));
  assert.ok(name.includes(DEFAULT_SPEECH_MODEL.version));
});

test('the model is about the size we tell the user', () => {
  const mb = bundleSizeMb(DEFAULT_SPEECH_MODEL);
  assert.ok(mb > 600 && mb < 750, `expected about 700 MB, got ${mb}`);
});

test('a file that is not there is missing', () => {
  assert.equal(
    fileState(DEFAULT_SPEECH_MODEL, installed({ present: false, sizeBytes: 0 })),
    'missing',
  );
});

test('a file of the wrong size is corrupt, not ready', () => {
  assert.equal(
    fileState(DEFAULT_SPEECH_MODEL, installed({ sizeBytes: 12345 })),
    'corrupt',
  );
});

test('a file of the right size that was never checked is verified before use', () => {
  assert.equal(
    fileState(DEFAULT_SPEECH_MODEL, installed({ verifiedVersion: null })),
    'verifying',
  );
});

test('a checked file of the current version is ready', () => {
  assert.equal(fileState(DEFAULT_SPEECH_MODEL, installed()), 'ready');
});

test('the model is only ready when every file is', () => {
  const all = DEFAULT_SPEECH_MODEL.files.map((f) => ({
    name: f.name,
    present: true,
    sizeBytes: f.sizeBytes,
    verifiedVersion: DEFAULT_SPEECH_MODEL.version,
  }));
  assert.equal(bundleReady(DEFAULT_SPEECH_MODEL, all), true);

  const oneMissing = all.map((f, i) =>
    i === 0 ? { ...f, present: false, sizeBytes: 0 } : f,
  );
  assert.equal(bundleReady(DEFAULT_SPEECH_MODEL, oneMissing), false);

  const oneUnchecked = all.map((f, i) =>
    i === 0 ? { ...f, verifiedVersion: null } : f,
  );
  assert.equal(bundleReady(DEFAULT_SPEECH_MODEL, oneUnchecked), false);
});

test('a file is checked against the size first, then the checksum', () => {
  const spec = DEFAULT_SPEECH_MODEL.files[0];
  const short = verifySpeechFile(
    DEFAULT_SPEECH_MODEL,
    spec.name,
    spec.sha256,
    spec.sizeBytes - 1,
  );
  assert.equal(short.ok, false);
  assert.match(short.ok ? '' : short.reason, /did not finish/);

  const wrong = verifySpeechFile(
    DEFAULT_SPEECH_MODEL,
    spec.name,
    '0'.repeat(64),
    spec.sizeBytes,
  );
  assert.equal(wrong.ok, false);
  assert.match(wrong.ok ? '' : wrong.reason, /not the file we published/);

  const right = verifySpeechFile(
    DEFAULT_SPEECH_MODEL,
    spec.name,
    spec.sha256,
    spec.sizeBytes,
  );
  assert.equal(right.ok, true);
});

test('a file that is not part of the model is refused', () => {
  const result = verifySpeechFile(DEFAULT_SPEECH_MODEL, 'nope.onnx', 'x', 1);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /no file called/);
});

test('progress is a whole percentage that never goes past the end', () => {
  assert.equal(progressPercent(0, 100), 0);
  assert.equal(progressPercent(50, 100), 50);
  assert.equal(progressPercent(150, 100), 100);
  assert.equal(progressPercent(-5, 100), 0);
  assert.equal(progressPercent(10, 0), 0);
});

test('the progress of a whole model counts each file by its size', () => {
  const bundle = DEFAULT_SPEECH_MODEL;
  const total = bundle.files.reduce((t, f) => t + f.sizeBytes, 0);

  assert.equal(bundleProgressPercent(bundle, {}), 0);

  // Each file counts for the share of the download it represents, so the number moves
  // evenly instead of jumping when a big file finishes.
  const encoder = bundle.files[0];
  const encoderShare = Math.round((encoder.sizeBytes / total) * 100);
  assert.ok(encoderShare > 85, `the encoder is most of the model, got ${encoderShare}%`);

  const halfEncoder = bundleProgressPercent(bundle, {
    'encoder.onnx': Math.floor(encoder.sizeBytes / 2),
  });
  assert.ok(
    Math.abs(halfEncoder - encoderShare / 2) <= 1,
    `half the encoder is about ${encoderShare / 2}%, got ${halfEncoder}%`,
  );

  // Everything downloaded is the whole thing.
  const all: Record<string, number> = {};
  for (const f of bundle.files) all[f.name] = f.sizeBytes;
  assert.equal(bundleProgressPercent(bundle, all), 100);
});

test('the user is told what the model is doing', () => {
  const none: InstalledFile[] = [];
  const missing = modelMessage(DEFAULT_SPEECH_MODEL, none);
  assert.equal(missing.ready, false);
  assert.match(missing.text, /Download the speech model/);

  const all = DEFAULT_SPEECH_MODEL.files.map((f) => ({
    name: f.name,
    present: true,
    sizeBytes: f.sizeBytes,
    verifiedVersion: DEFAULT_SPEECH_MODEL.version,
  }));
  const ready = modelMessage(DEFAULT_SPEECH_MODEL, all);
  assert.equal(ready.ready, true);
  assert.match(ready.text, /installed and checked/);

  const corrupt = all.map((f, i) =>
    i === 0 ? { ...f, sizeBytes: 10 } : f,
  );
  const broken = modelMessage(DEFAULT_SPEECH_MODEL, corrupt);
  assert.equal(broken.ready, false);
  assert.match(broken.text, /did not download properly/);
});
