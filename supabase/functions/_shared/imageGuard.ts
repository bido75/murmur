/**
 * Magic-byte allowlist for images embedded into generated documents.
 *
 * pptxgenjs runs every embedded image through `image-size`; the currently
 * pinned 1.2.1 has unbounded-loop parsers for ICNS/JXL/HEIF inputs
 * (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) with no fixed version reachable
 * through pptxgenjs. User-uploaded photos flow into decks, so the vulnerable
 * parsers are reachable. This guard only lets JPEG and PNG bytes through,
 * which image-size parses with bounded logic. Anything else is rejected by
 * the caller instead of being embedded.
 */

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export type EmbeddedImageCheck = { ok: true; format: "jpeg" | "png" } | { ok: false; reason: string };

export function classifyEmbeddedImage(bytes: Uint8Array): EmbeddedImageCheck {
  if (bytes.length < 12) return { ok: false, reason: "image too small to classify" };
  if (JPEG_MAGIC.every((b, i) => bytes[i] === b)) return { ok: true, format: "jpeg" };
  if (PNG_MAGIC.every((b, i) => bytes[i] === b)) return { ok: true, format: "png" };
  return { ok: false, reason: "only JPEG and PNG photos can be embedded in decks" };
}
