#!/usr/bin/env node
// Repair UTF-8-as-CP1252 double-encoding ("mojibake") in one file, using an
// explicit corrupted->intended map. No blind replacement: every sequence is a
// specific CP1252 mis-decode with a known intended character.
// Usage: node repair-mojibake.cjs <file> [--apply]
import { readFileSync, writeFileSync } from "node:fs";

// CP1252 special-byte -> intended char table (for tests and the general repair).
export const CP1252_SPECIALS = {
  0x80: "\u20AC", // €
  0x82: "\u201A", // ‚
  0x83: "\u0192", // ƒ
  0x84: "\u201E", // „
  0x85: "\u2026", // …
  0x86: "\u2020", // †
  0x87: "\u2021", // ‡
  0x88: "\u02C6", // ˆ
  0x89: "\u2030", // ‰
  0x8a: "\u0160", // Š
  0x8b: "\u2039", // ‹
  0x8c: "\u0152", // Œ
  0x8e: "\u017d", // Ž
  0x91: "\u2018", // '
  0x92: "\u2019", // '
  0x93: "\u201c", // "
  0x94: "\u201d", // "
  0x95: "\u2022", // •
  0x96: "\u2013", // –
  0x97: "\u2014", // —
  0x98: "\u02dc", // ˜
  0x99: "\u2122", // ™
  0x9a: "\u0161", // š
  0x9b: "\u203a", // ›
  0x9c: "\u0153", // œ
  0x9e: "\u017e", // ž
  0x9f: "\u0178", // Ÿ
};

// Reverse of the table above: corrupted char -> original byte.
const CHAR_TO_BYTE = {};
for (const [byte, ch] of Object.entries(CP1252_SPECIALS)) CHAR_TO_BYTE[ch] = Number(byte);

/** Encode a string's codepoints as CP1252 bytes (inverse of the corruption). */
export function cp1252Encode(s) {
  const bytes = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp < 0x100) bytes.push(cp);
    else if (CHAR_TO_BYTE[ch] !== undefined) bytes.push(CHAR_TO_BYTE[ch]);
    else throw new Error(`Not representable in CP1252: U+${cp.toString(16)} (${ch})`);
  }
  return Buffer.from(bytes);
}

/** Repair text that was UTF-8, mis-read as CP1252, and re-saved as UTF-8. */
export function repairMojibake(s) {
  return cp1252Encode(s).toString("utf8");
}

const SPECIFIC = [
  ["\u00e2\u20ac\u00a6", "\u2026"], // â€¦ -> …
  ["\u00e2\u20ac\u0153", "\u201c"], // â€œ -> "
  ["\u00e2\u20ac\u009d", "\u201d"], // â€<U+009D> -> "
  ["\u00e2\u20ac\u00a2", "\u2022"], // â€¢ -> •
  ["\u00e2\u20ac\u2122", "\u2019"], // â€™ -> '
  ["\u00e2\u20ac\u02c6", "\u2018"], // â€ˆ -> '
  ["\u00e2\u20ac\u201c", "\u2014"], // â€" (â € ") -> —
  ["\u00e2\u20ac\u201d", "\u2014"], // â€- variant
  ["\u00c2\u00b7", "\u00b7"], // Â· -> ·
  ["\u00c2\u00a0", "\u00a0"], // Â<nobr> -> nobr space
];

const file = process.argv[2];
const apply = process.argv.includes("--apply");
let text = readFileSync(file, "utf8");

// Pass 1: full-stream CP1252->UTF-8 reversal (the file was corrupted wholesale).
let repaired;
let viaFullStream = false;
try {
  const candidate = repairMojibake(text);
  const stillBad = /[\u00e2\u20ac\u0153\u00e2\u20ac\u00a2\u00c2\u00b7\u00c3\u0083\u00c3\u0082]/u.test(candidate);
  if (!stillBad) {
    repaired = candidate;
    viaFullStream = true;
  }
} catch {
  /* fall through to specific mapping */
}

// Pass 2 (fallback / partial corruption): targeted sequence mapping.
if (!viaFullStream) {
  repaired = text;
  for (const [bad, good] of SPECIFIC) repaired = repaired.split(bad).join(good);
}

const before = text;
const changes = [];
const bl = before.split("\n"), rl = repaired.split("\n");
for (let i = 0; i < Math.max(bl.length, rl.length); i++) {
  if (bl[i] !== rl[i]) changes.push({ line: i + 1, before: bl[i], after: rl[i] });
}
console.log(`file: ${file}`);
console.log(`method: ${viaFullStream ? "full-stream CP1252 reversal" : "targeted sequence mapping"}`);
console.log(`changed lines: ${changes.length}`);
for (const c of changes) {
  console.log(`L${c.line}`);
  console.log(`  - ${JSON.stringify(c.before.trim().slice(0, 110))}`);
  console.log(`  + ${JSON.stringify(c.after.trim().slice(0, 110))}`);
}
const leftover = /[\u00e2][\u20ac][\u00a2\u0153\u00a6\u0099\u201c\u201d\u2013\u2014]|[\u00c2][\u00b7\u00b0]/u.test(repaired);
console.log(`mojibake remaining after repair: ${leftover}`);
if (apply) {
  writeFileSync(file, repaired, "utf8");
  console.log("APPLIED (written back as UTF-8, no BOM)");
} else {
  console.log("dry run only (pass --apply to write)");
}
