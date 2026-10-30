/**
 * Mojibake detection and repair.
 *
 * Root cause context: files written through a Windows PowerShell 5.1 pipeline
 * can be read as ANSI (CP1252) and written back as UTF-8, double-encoding
 * non-ASCII characters (e.g. `•` U+2022 → `â€¢` as UTF-8). These helpers
 * detect that specific corruption and repair it conservatively:
 *  - full-stream reversal (CP1252 bytes re-decoded as UTF-8) is used only when
 *    the entire document round-trips cleanly (no false positives on mixed
 *    content);
 *  - otherwise a targeted map repairs only confident CP1252→UTF8 sequences.
 *
 * Never blind-replace: text that is already correctly encoded must pass
 * through unchanged.
 */

/** CP1252 bytes for the lead characters of common double-encoded UTF-8 sequences. */
const CP1252_REVERSIBLE = [
  { cp1252Lead: "Ã", utf8Lead: 0xc3 },
  { cp1252Lead: "Â", utf8Lead: 0xc2 },
  { cp1252Lead: "â€", utf8Lead: 0xe2 },
  { cp1252Lead: "ðŸ", utf8Lead: 0xf0 },
];

/** Targeted repairs for CP1252-mangled sequences, highest-confidence first.
 *  Keys are the corrupted ASCII-safe sequences; values the intended characters. */
export const MOJIBAKE_MAP: Array<[string, string]> = [
  ["â€”", "—"],
  ["â€“", "–"],
  ["â€˜", "‘"],
  ["â€™", "’"],
  ["â€œ", "“"],
  ["â€\u009D", "”"],
  ["â€¢", "•"],
  ["â€¦", "…"],
  ["â€°", "‰"],
  ["â€¹", "‹"],
  ["â€º", "›"],
  ["Â·", "·"],
  ["Â«", "«"],
  ["Â»", "»"],
  ["Â¿", "¿"],
  ["Â¡", "¡"],
  ["Â°", "°"],
  ["Â©", "©"],
  ["Â®", "®"],
  ["Â±", "±"],
  ["Â½", "½"],
  ["Â¼", "¼"],
  ["Â¾", "¾"],
  ["Âµ", "µ"],
  ["Ã©", "é"],
  ["Ã¨", "è"],
  ["Ãª", "ê"],
  ["Ã«", "ë"],
  ["Ã¡", "á"],
  ["Ã ", "à"],
  ["Ã¢", "â"],
  ["Ã£", "ã"],
  ["Ã§", "ç"],
  ["Ã­", "í"],
  ["Ã®", "î"],
  ["Ã¯", "ï"],
  ["Ã³", "ó"],
  ["Ã²", "ò"],
  ["Ã´", "ô"],
  ["Ãµ", "õ"],
  ["Ã¶", "ö"],
  ["Ãº", "ú"],
  ["Ã¹", "ù"],
  ["Ã»", "û"],
  ["Ã¼", "ü"],
  ["Ã½", "ý"],
  ["ÃŸ", "ß"],
  ["Ã‘", "Ñ"],
  ["Ã±", "ñ"],
  ["Ã…", "Å"],
  ["Ã†", "Æ"],
  ["Ã˜", "Ø"],
  ["Ãœ", "Ü"],
  ["Ã„", "Ä"],
  ["Ã–", "Ö"],
  ["Ã‰", "É"],
  ["Ãˆ", "È"],
  ["ÃŠ", "Ê"],
  ["Ã‹", "Ë"],
  ["Ã”", "Ô"],
  ["Ã›", "Û"],
  ["Ã‡", "Ç"],
  ["Ã", "À"],
];

/** Substrings that indicate likely CP1252→UTF-8 double encoding. */
export const MOJIBAKE_SIGNATURES = [
  "â€",
  "Ã",
  "Â·",
  "Â«",
  "Â»",
  "Â¿",
  "Â¡",
  "Â°",
  "Â©",
  "Â®",
  "Â½",
  "Ã©",
  "Ã¨",
  "Ã¡",
  "Ã³",
  "Ãº",
  "Ã±",
  "Ã¼",
  "Ã¶",
  "Ã„",
  "Ã–",
  "Ãœ",
  "ÃŸ",
  "ðŸ",
] as const;

export function looksLikeMojibake(text: string): boolean {
  return MOJIBAKE_SIGNATURES.some((sig) => text.includes(sig));
}

/**
 * Attempt to reverse CP1252→UTF-8 double-encoding for the whole string.
 * Returns the repaired string only if every byte of the CP1252-encoded form
 * decodes as valid UTF-8; otherwise returns null (mixed/ambiguous content).
 */
export function tryFullStreamReverse(text: string): string | null {
  if (!looksLikeMojibake(text)) return text;
  try {
    const bytes: number[] = [];
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      if (code < 0x100) {
        const byte = cp1252ToByte(code);
        if (byte === null) return null;
        bytes.push(byte);
      } else {
        // Genuine multi-byte content (curly quotes beyond CP1252 range, CJK…)
        return null;
      }
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes),
    );
    return decoded;
  } catch {
    return null;
  }
}

function cp1252ToByte(code: number): number | null {
  if (code < 0x80) return code;
  // CP1252 maps 0x80–0x9F to Windows-specific glyphs; a handful appear in mojibake.
  const high: Record<number, number> = {
    0x20ac: 0x80, // €
    0x201a: 0x82,
    0x0192: 0x83,
    0x201e: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02c6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8a,
    0x2039: 0x8b,
    0x0152: 0x8c,
    0x017d: 0x8e,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02dc: 0x98,
    0x2122: 0x99,
    0x0161: 0x9a,
    0x203a: 0x9b,
    0x0153: 0x9c,
    0x017e: 0x9e,
    0x0178: 0x9f,
  };
  if (code in high) return high[code];
  if (code >= 0xa0 && code <= 0xff) return code;
  return null;
}

/**
 * Repair mojibake in a string.
 * 1. Try full-stream reversal (safe when the whole string is double-encoded).
 * 2. Fall back to targeted, highest-confidence sequence repair.
 * 3. Strings without corruption are returned unchanged.
 */
export function repairMojibake(text: string): string {
  const full = tryFullStreamReverse(text);
  if (full !== null && !looksLikeMojibake(full)) return full;
  let out = text;
  for (const [bad, good] of MOJIBAKE_MAP) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  return out;
}

/** Remove zero-width/invisible encoding artifacts. */
export function stripInvisibleArtifacts(text: string): string {
  return text
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ");
}

/**
 * Normalize text that may carry encoding artifacts (used on transcripts,
 * notes and exports before display/storage). Correctly encoded text is
 * preserved byte-for-byte in content; only invisible artifacts and
 * confidently-identified mojibake are touched.
 */
export function normalizeEncodingArtifacts(text: string): string {
  return stripInvisibleArtifacts(repairMojibake(text));
}
