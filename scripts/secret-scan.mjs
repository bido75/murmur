#!/usr/bin/env node
// Repo-owned secret scanner. No third-party dependency: deterministic patterns,
// redacted output (only file/line/rule are reported, never the matched text).
//
//   node scripts/secret-scan.mjs            scan the whole tracked tree
//   node scripts/secret-scan.mjs --diff     scan only lines added vs merge-base
//
// Exit codes: 0 = clean, 1 = finding, 2 = usage/IO error.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RULES = [
  { id: "openai-anthropic-key", re: /sk-(proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { id: "github-token", re: /gh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: "hubspot-token", re: /pat-na2-[A-Za-z0-9-]{10}/ },
  { id: "slack-token", re: /xox[abprs]-[A-Za-z0-9-]{10}/ },
  { id: "google-api-key", re: /AIza[A-Za-z0-9_-]{20}\b/ },
  { id: "stripe-key", re: /[srp]k_(live|test)_[A-Za-z0-9]{10,}/ },
  { id: "twilio-key", re: /SK[a-f0-9]{32}/ },
  { id: "aws-access-key", re: /AKIA[A-Z0-9]{16}\b/ },
  { id: "private-key-block", re: /-----BEGIN (RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  {
    id: "generic-secret-assignment",
    re: /(secret|password|token|api_?key|client_secret)\s*[:=]\s*["'][A-Za-z0-9+/]{32,}["']/i,
  },
];

// Files that legitimately contain secret-shaped documentation text (never real values).
const ALLOWED_PATHS = [/^\.env\.example$/, /docs\/.*\.md$/, /CHANGELOG/i];

const mode = process.argv[2] ?? "tree";
if (mode !== "tree" && mode !== "--diff") {
  console.error("usage: node scripts/secret-scan.mjs [--diff]");
  process.exit(2);
}

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

let findings = 0;

function scanLine(file, lineNo, text) {
  for (const rule of RULES) {
    if (rule.re.test(text) && !ALLOWED_PATHS.some((p) => p.test(file))) {
      console.log(`SECRET-SCAN ${rule.id}: ${file}:${lineNo} (value redacted)`);
      findings++;
    }
  }
}

if (mode === "tree") {
  for (const f of files) {
    let content;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue; // binary or unreadable
    }
    content.split(/\r?\n/).forEach((line, i) => scanLine(f, i + 1, line));
  }
} else {
  // On a CI checkout only the pushed branch exists locally; prefer origin/main.
  let base;
  try {
    base = execSync("git merge-base origin/main HEAD", { encoding: "utf8" }).trim();
  } catch {
    base = execSync("git merge-base main HEAD", { encoding: "utf8" }).trim();
  }
  const diff = execSync(`git diff ${base}...HEAD --unified=0 --no-color`, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  let file = null;
  let newLine = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("@@")) {
      const m = /\+(\d+)/.exec(line);
      newLine = m ? parseInt(m[1], 10) : 0;
    } else if (line.startsWith("+") && file) {
      scanLine(file, newLine, line.slice(1));
      newLine++;
    }
  }
}

if (findings) {
  console.log(`secret-scan: ${findings} finding(s)`);
  process.exit(1);
}
console.log("secret-scan: clean");
