// Reading a zip file.
//
// The speech model is published as a zip, so it is downloaded as one, checked as one
// and opened as one. Node can inflate a deflate stream but cannot open a zip, and
// adding a library for one file is not worth it — so the archive is read here.
//
// The archive is read from the file rather than loaded into memory: it is 580 MB, and
// the model inside it is 650 MB, so holding either of them would be a lot to ask of a
// computer. Only the index and one entry at a time are held.
//
// Pure enough to be tested: the buffer-backed reader is used for the tests, and the
// file-backed one for the real download.

import { inflateRawSync, createInflateRaw } from "node:zlib";
import {
  createReadStream,
  createWriteStream,
  openSync,
  readSync,
  closeSync,
  statSync,
} from "node:fs";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

export type ZipEntry = {
  /** The name inside the archive. */
  name: string;
  /** The size of the file once unpacked. */
  size: number;
  /** How it is stored: 0 is as-is, 8 is deflated. */
  method: number;
  /** The CRC-32 the archive records, so the unpacked bytes can be checked. */
  crc: number;
  /** Where the file's own header starts in the archive. */
  offset: number;
  /** The size of the file as stored. */
  compressedSize: number;
};

export type ZipArchive = {
  entries: ZipEntry[];
  /** The bytes of the whole archive. */
  bytes: Uint8Array;
};

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0
  );
}

/**
 * Read an archive's index.
 *
 * `read` is called with an offset and a length, and returns those bytes. That is
 * enough to read the end of the file and then the index, whether the archive is in
 * memory or on disk.
 */
function readIndex(
  read: (offset: number, length: number) => Uint8Array,
  totalSize: number,
): ZipEntry[] {
  // The end-of-central-directory record is at the very end, unless there is a comment.
  const tailLength = Math.min(totalSize, 0xffff + 22);
  const tail = read(totalSize - tailLength, tailLength);
  let eocd = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (u32(tail, at) === END_OF_CENTRAL_DIRECTORY) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0)
    throw new Error("That file is not a zip archive, or it is damaged.");

  const count = u16(tail, eocd + 10);
  const directoryOffset = u32(tail, eocd + 16);
  const directory = read(directoryOffset, count * 46 + 4096);

  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > directory.length || u32(directory, at) !== CENTRAL_FILE_HEADER)
      throw new Error("The zip archive's index is damaged.");
    const method = u16(directory, at + 10);
    const crc = u32(directory, at + 16);
    const compressed = u32(directory, at + 20);
    const size = u32(directory, at + 24);
    const nameLength = u16(directory, at + 28);
    const extraLength = u16(directory, at + 30);
    const commentLength = u16(directory, at + 32);
    const offset = u32(directory, at + 42);
    const name = Buffer.from(
      directory.subarray(at + 46, at + 46 + nameLength),
    ).toString("utf8");
    if (size === 0xffffffff || compressed === 0xffffffff || offset === 0xffffffff)
      throw new Error("This zip archive is too large for this app to open.");
    entries.push({
      name,
      size,
      method,
      crc,
      offset,
      compressedSize: compressed,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Open an archive that is already in memory.
 */
export function openZip(bytes: Uint8Array): ZipArchive {
  const entries = readIndex((offset, length) => {
    const out = new Uint8Array(length);
    out.set(bytes.subarray(offset, offset + length));
    return out;
  }, bytes.length);
  return { entries, bytes };
}

/**
 * Open an archive on disk, without reading it all.
 */
export function openZipFile(path: string): ZipEntry[] {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    return readIndex((offset, length) => {
      const out = new Uint8Array(length);
      const read = readSync(fd, out, 0, length, offset);
      return out.subarray(0, read);
    }, size);
  } finally {
    closeSync(fd);
  }
}

/**
 * Read one file out of an archive that is in memory.
 *
 * The bytes are checked against the CRC-32 the archive records, so a damaged download
 * is caught before it is used.
 */
export function readZipEntry(zip: ZipArchive, name: string): Uint8Array {
  const entry = zip.entries.find((e) => e.name === name);
  if (!entry) throw new Error(`The archive does not contain ${name}.`);

  const bytes = zip.bytes;
  const header = entry.offset;
  if (u32(bytes, header) !== LOCAL_FILE_HEADER)
    throw new Error(`The archive is damaged at ${name}.`);
  const nameLength = u16(bytes, header + 26);
  const extraLength = u16(bytes, header + 28);
  const start = header + 30 + nameLength + extraLength;

  let out: Buffer;
  if (entry.method === 0) {
    out = Buffer.from(bytes.subarray(start, start + entry.size));
  } else if (entry.method === 8) {
    // A deflate stream has no header of its own, so it is inflated raw.
    out = inflateRawSync(Buffer.from(bytes.subarray(start)));
  } else {
    throw new Error(`The archive stores ${name} in a way this app cannot read.`);
  }

  if (out.length !== entry.size)
    throw new Error(`${name} did not unpack to the size the archive says.`);
  if (crc32(out) !== entry.crc)
    throw new Error(`${name} is damaged, so it was not used.`);
  return new Uint8Array(out);
}

/**
 * Unpack one file from an archive on disk, straight to a file.
 *
 * The compressed bytes are read and inflated a piece at a time, so a 650 MB model
 * never sits in memory.
 */
export async function extractZipFile(
  path: string,
  entries: ZipEntry[],
  name: string,
  destination: string,
): Promise<void> {
  const entry = entries.find((e) => e.name === name);
  if (!entry) throw new Error(`The archive does not contain ${name}.`);

  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(30);
    readSync(fd, header, 0, 30, entry.offset);
    if (header.readUInt32LE(0) !== LOCAL_FILE_HEADER)
      throw new Error(`The archive is damaged at ${name}.`);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const start = entry.offset + 30 + nameLength + extraLength;

    if (entry.method === 0) {
      // Stored as-is: copy it across.
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(destination);
        const input = createReadStream(path, {
          start,
          end: start + entry.size - 1,
        });
        input.on("error", reject);
        out.on("error", reject);
        out.on("finish", () => resolve());
        input.pipe(out);
      });
      return;
    }
    if (entry.method !== 8)
      throw new Error(`The archive stores ${name} in a way this app cannot read.`);

    // Deflated: inflate it as it arrives.
    const input = createReadStream(path, {
      start,
      end: start + entry.compressedSize - 1,
    });
    const inflate = createInflateRaw();
    const out = createWriteStream(destination);
    await new Promise<void>((resolve, reject) => {
      input.on("error", reject);
      inflate.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
      input.pipe(inflate).pipe(out);
    });
    void size;
  } finally {
    closeSync(fd);
  }
}

/** The names of the files in the archive, in the order they are listed. */
export function zipNames(zip: ZipArchive): string[] {
  return zip.entries.map((e) => e.name);
}

// ---------- CRC-32 ----------

let crcTable: Uint32Array | null = null;

function crcTableFor(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** The CRC-32 the zip format uses. */
export function crc32(bytes: Uint8Array): number {
  const table = crcTableFor();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
