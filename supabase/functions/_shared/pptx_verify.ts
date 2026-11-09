// Inspect a .pptx (a ZIP archive) for embedded media and slide count, so an exported
// deck can be verified in CI without opening PowerPoint. Pure and dependency-free: it
// parses only the ZIP central directory, which stores entry names uncompressed.

export type PptxInspection = {
  /** Entries under ppt/media/, e.g. "ppt/media/image1.png". */
  media: string[];
  /** Number of ppt/slides/slideN.xml entries. */
  slides: number;
  /** Total compressed bytes of embedded media. */
  mediaBytes: number;
};

export function inspectPptx(bytes: Uint8Array): PptxInspection {
  const media: string[] = [];
  let mediaBytes = 0;
  let slides = 0;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End of Central Directory record (0x06054b50), scanning the trailing 64KB.
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { media, slides, mediaBytes };

  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const end = cdOffset + cdSize;

  const dec = new TextDecoder('utf-8');
  let p = cdOffset;
  for (let n = 0; n < count && p + 46 <= end; n++) {
    // Central directory file header (0x02014b50); skip a possible digital signature.
    if (dv.getUint32(p, true) === 0x05054b50) {
      p += dv.getUint32(p + 4, true);
      continue;
    }
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const compSize = dv.getUint32(p + 20, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name.startsWith('ppt/media/') && !name.endsWith('/')) {
      media.push(name);
      mediaBytes += compSize;
    } else if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
      slides++;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  return { media, slides, mediaBytes };
}

/** True when the deck actually contains embedded image files (not just a placeholder). */
export function hasEmbeddedImages(bytes: Uint8Array): boolean {
  return inspectPptx(bytes).media.length > 0;
}