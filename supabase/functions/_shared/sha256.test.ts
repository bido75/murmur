import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Sha256, sha256Hex, sha256HexOfText } from './sha256.ts';

const enc = (s: string) => new TextEncoder().encode(s);

test('SHA-256 matches the published test vectors', () => {
  // The empty string.
  assert.equal(
    sha256Hex(new Uint8Array(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex(enc('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('SHA-256 of text is the hash of its UTF-8 bytes', () => {
  // A string with characters outside ASCII must hash as UTF-8, not as code points.
  assert.equal(sha256HexOfText('café'), sha256Hex(enc('café')));
  assert.equal(
    sha256HexOfText(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('SHA-256 handles a message that needs padding', () => {
  // 55, 56, 63 and 64 bytes each cross a padding boundary.
  const known: Record<number, string> = {
    55: '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
    56: 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
    64: 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
  };
  for (const [len, hash] of Object.entries(known)) {
    const n = Number(len);
    const bytes = new Uint8Array(n).fill(0x61);
    assert.equal(sha256Hex(bytes), hash, `${n} bytes`);
  }
});

test('SHA-256 agrees with the crypto the platform provides', () => {
  // A random-ish buffer compared against the platform's implementation, so a mistake in
  // the padding or the rounds is caught rather than assumed away.
  const bytes = new Uint8Array(1000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 13) & 0xff;
  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256Hex(bytes), expected);
});

test('the hash is the same however the bytes are divided up', () => {
  // The app hashes a 60 MB model a few megabytes at a time, so the pieces have to give
  // exactly the same answer as hashing it all at once.
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1000, 4096]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const whole = createHash('sha256').update(bytes).digest('hex');

    for (const chunk of [1, 7, 64, 100, 333]) {
      const hasher = new Sha256();
      for (let off = 0; off < bytes.length; off += chunk) {
        hasher.update(bytes.subarray(off, Math.min(off + chunk, bytes.length)));
      }
      assert.equal(
        hasher.digest(),
        whole,
        `${size} bytes in pieces of ${chunk}`,
      );
    }
  }
});

test('a hash cannot be finished twice', () => {
  const hasher = new Sha256().update(enc('abc'));
  hasher.digest();
  assert.throws(() => hasher.digest(), /already been finished/);
  assert.throws(() => hasher.update(enc('x')), /already been finished/);
});
