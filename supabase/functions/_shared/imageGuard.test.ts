import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmbeddedImage } from './imageGuard.ts';

function bytes(...prefix: number[]): Uint8Array {
  return new Uint8Array([...prefix, ...new Array(24).fill(0x00)]);
}

test('JPEG and PNG bytes are allowed', () => {
  assert.deepEqual(classifyEmbeddedImage(bytes(0xff, 0xd8, 0xff, 0xe0)), { ok: true, format: "jpeg" });
  assert.deepEqual(classifyEmbeddedImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), { ok: true, format: "png" });
});

test('the advisory-affected formats are rejected (ICNS, JXL codestream, JXL container, HEIF)', () => {
  assert.equal(classifyEmbeddedImage(bytes(0x69, 0x63, 0x6e, 0x73)).ok, false, "icns");
  assert.equal(classifyEmbeddedImage(bytes(0xff, 0x0a, 0x00, 0x01)).ok, false, "jxl codestream");
  assert.equal(classifyEmbeddedImage(bytes(0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20)).ok, false, "jxl container");
  assert.equal(classifyEmbeddedImage(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70)).ok, false, "heif/ftyp");
});

test('truncated and empty payloads are rejected', () => {
  assert.equal(classifyEmbeddedImage(new Uint8Array(0)).ok, false);
  assert.equal(classifyEmbeddedImage(new Uint8Array(8)).ok, false);
});

test('a rejected classification explains the user-facing reason', () => {
  const r = classifyEmbeddedImage(bytes(0x69, 0x63, 0x6e, 0x73));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /JPEG and PNG/);
});
