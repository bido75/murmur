#!/usr/bin/env node
// Byte-level mojibake scanner: detects UTF-8-as-CP1252 double-encoding signatures.
// Usage: node scan-mojibake.mjs worktree|head [root]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const mode = process.argv[2] || "worktree";
const root = process.argv[3] || "C:\\Users\\vinny\\Documents\\murmur-ready\\murmur";

// Signature byte-sequences (as they appear in double-encoded UTF-8 files)
const SIG = {
  "â€": Buffer.from([0xc3, 0xa2, 0xe2, 0x82, 0xac]), // â€ from • " " … etc start
  "Ã+": Buffer.from([0xc3, 0x83]), // Ã (from any C3-prefixed UTF-8 lead)
  "Â": Buffer.from([0xc3, 0x82]), // Â (from C2-prefixed lead: ·, °, etc.)
  BOM: Buffer.from([0xef, 0xbb, 0xbf]),
};
const CODEPOINTS = new Set([0xc3, 0xa2, 0xe2, 0x82, 0xac, 0x83, 0x82]);

function scan(buf, name) {
  const hits = {};
  for (const [label, sig] of Object.entries(SIG)) {
    let count = 0;
    for (let i = 0; i <= buf.length - sig.length; i++) {
      let ok = true;
      for (let j = 0; j < sig.length; j++) if (buf[i + j] !== sig[j]) { ok = false; break; }
      if (ok) count++;
    }
    if (count) hits[label] = count;
  }
  return Object.keys(hits).length ? hits : null;
}

function listFiles() {
  if (mode === "head") {
    const out = execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", "HEAD"], { cwd: root, encoding: "buffer" });
    return out.toString("utf8").split("\0").filter(Boolean);
  }
  // worktree: use git ls-files (tracked) + skip binary-ish by extension filter later
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer" });
  return out.toString("utf8").split("\0").filter(Boolean);
}

const files = listFiles();
const report = [];
for (const f of files) {
  if (/\.(png|jpg|jpeg|gif|ico|webp|pdf|zip|apk|woff2?|ttf|otf|mp3|mp4|wav|m4a|node|jar|dex|so)$/i.test(f)) continue;
  let buf;
  try {
    buf = mode === "head"
      ? execFileSync("git", ["show", `HEAD:${f}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      : readFileSync(join(root, f));
  } catch { continue; } // deleted in worktree etc.
  const hits = scan(buf, f);
  if (hits) report.push({ file: f, hits });
}

// summary
const bySig = {};
for (const r of report) for (const k of Object.keys(r.hits)) bySig[k] = (bySig[k] || 0) + 1;
console.log(`MODE=${mode} scanned=${files.length} files_with_signatures=${report.length}`);
console.log("signature totals:", JSON.stringify(bySig));
for (const r of report) {
  console.log(`${JSON.stringify(r.hits)} ${r.file}`);
}
