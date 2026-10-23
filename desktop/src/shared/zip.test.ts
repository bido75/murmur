import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  crc32,
  extractZipFile,
  openZip,
  openZipFile,
  readZipEntry,
  zipNames,
} from "./zip.ts";

const ARCHIVE =
  "C:\\Users\\vinny\\AppData\\Local\\Temp\\opencode\\parakeet-model.zip";

test("CRC-32 matches the published check value", () => {
  // The check value every zip implementation is tested against.
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("a zip that is not a zip is refused", () => {
  assert.throws(
    () => openZip(new TextEncoder().encode("not a zip file at all, really")),
    /not a zip archive/,
  );
});

test("the model archive opens and lists its files", { skip: !exists(ARCHIVE) }, () => {
  // Read from the file, so the 580 MB archive is never held in memory.
  const entries = openZipFile(ARCHIVE);
  const names = entries.map((e) => e.name);
  assert.ok(
    names.some((n) => n.endsWith("nemo128.onnx")),
    "the mel front end is in the archive",
  );
  assert.ok(
    names.some((n) => n.endsWith("encoder-model.int8.onnx")),
    "the encoder is in the archive",
  );
  assert.ok(
    names.some((n) => n.endsWith("decoder_joint-model.int8.onnx")),
    "the joint is in the archive",
  );
  assert.ok(
    names.some((n) => n.endsWith("vocab.txt")),
    "the vocabulary is in the archive",
  );
});

test(
  "the files come out of the archive with the right bytes",
  { skip: !exists(ARCHIVE) },
  async () => {
    const entries = openZipFile(ARCHIVE);
    const entry = entries.find((e) => e.name.endsWith("vocab.txt"))!;
    const out = join(tmpdir(), "murmur-zip-test-vocab.txt");
    await extractZipFile(ARCHIVE, entries, entry.name, out);
    try {
      // The same file, read by Python's zipfile: the first line names the first token.
      const text = readFileSync(out, "utf8");
      assert.ok(text.startsWith("<unk> 0"), "the vocabulary starts with the unknown token");
      assert.ok(text.includes("<blk> 8192"), "the blank token is the last one");

      // And the bytes match the file that was extracted separately.
      const separate = new Uint8Array(
        readFileSync(
          "C:\\Users\\vinny\\AppData\\Local\\Temp\\opencode\\parakeet-bundle\\parakeet-tdt-0.6b-v3-int8\\vocab.txt",
        ),
      );
      const unpacked = new Uint8Array(readFileSync(out));
      assert.equal(unpacked.length, separate.length);
      assert.equal(
        createHash("sha256").update(unpacked).digest("hex"),
        createHash("sha256").update(separate).digest("hex"),
        "the unpacked file is the same as the extracted one",
      );
    } finally {
      rmSync(out, { force: true });
    }
  },
);

function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
