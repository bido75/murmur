#!/usr/bin/env node
// Language capability matrix: translate fixed sample lines into a language via
// the live provider and record the result. Run with a language subset by default;
// --all runs every production-tier language (costs ~92 small API calls).
//
// Usage:
//   node scripts/language-capability.mjs                    # representative subset
//   node scripts/language-capability.mjs sw yo am ar        # specific codes
//   node scripts/language-capability.mjs --all              # all production-tier
//
// Writes docs/multilingual/language-capabilities.json (merged with previous runs).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const env = Object.fromEntries(
  readFileSync(join(root, "supabase/functions/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const { LANGUAGE_REGISTRY, PRODUCTION_TRANSLATION_LANGUAGES } = await import(
  pathToFileURL(join(root, "supabase/functions/_shared/languages.ts"))
);

const SAMPLES = [
  "The meeting starts at nine tomorrow morning.",
  "Please send the report by Friday.",
  "We agreed to review the budget next week.",
];

const REPRESENTATIVE = ["sw", "yo", "am", "ar", "zh", "hi", "ha", "es", "fr", "ak"];
const args = process.argv.slice(2);
const all = args.includes("--all");
const codes = all
  ? PRODUCTION_TRANSLATION_LANGUAGES.map((l) => l.code)
  : args.length
    ? args
    : REPRESENTATIVE;

const provider = env.LLM_PROVIDER || "openrouter";
const model = env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
const system = [
  "Translate each line into {LANGUAGE}.",
  "Return exactly one output line per input line, in the same order. Keep empty lines empty.",
  "Keep names, product names, numbers, dates and units exactly as they are.",
].join("\n");

async function translate(langName, lines) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [
        { role: "system", content: system.replace("{LANGUAGE}", langName) },
        { role: "user", content: JSON.stringify(lines) },
      ],
      tools: [{
        type: "function",
        function: {
          name: "translated",
          description: "Return the translated lines.",
          parameters: {
            type: "object",
            properties: { lines: { type: "array", items: { type: "string" } } },
            required: ["lines"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "translated" } },
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: body?.error?.message ?? `HTTP ${res.status}` };
  const args = body?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return { ok: false, error: "no tool call in response" };
  const parsed = JSON.parse(args);
  if (!Array.isArray(parsed.lines) || parsed.lines.length !== lines.length)
    return { ok: false, error: `line count mismatch: got ${parsed.lines?.length}` };
  // Untranslated-echo check: if every output line is byte-identical to its
  // input, the model did not translate — record honestly rather than "verified".
  const identical = parsed.lines.every((out, i) => out.trim() === lines[i].trim());
  if (identical) return { ok: false, error: "untranslated echo (output identical to input)" };
  return { ok: true, lines: parsed.lines.map(String) };
}

// Merge with previous results so incremental runs accumulate.
const outFile = join(root, "docs/multilingual/language-capabilities.json");
const prev = existsSync(outFile)
  ? JSON.parse(readFileSync(outFile, "utf8"))
  : { date_updated: null, provider, model, samples: SAMPLES, results: {} };

let verified = 0, failed = 0;
for (const code of codes) {
  const entry = LANGUAGE_REGISTRY.find((l) => l.code === code);
  if (!entry) { console.log(`SKIP ${code}: not in registry`); continue; }
  if (entry.translation === "llm-experimental") { console.log(`SKIP ${code}: experimental tier`); continue; }
  process.stdout.write(`${code} (${entry.name}) ... `);
  try {
    let r = await translate(entry.name, SAMPLES);
    // One retry: the provider occasionally echoes for no clear reason
    // (proven transient — zh/hi/ja passed a subset run then echoed in the full run).
    if (!r.ok && r.error === "untranslated echo (output identical to input)") {
      console.log("echo, retrying...");
      r = await translate(entry.name, SAMPLES);
    }
    if (r.ok) {
      prev.results[code] = {
        name: entry.name, status: "verified", provider, model,
        date: new Date().toISOString().slice(0, 10),
        sample_in: SAMPLES[0], sample_out: r.lines[0],
        all_lines: r.lines,
      };
      verified++;
      console.log("VERIFIED");
    } else {
      prev.results[code] = { name: entry.name, status: "failed", error: r.error, date: new Date().toISOString().slice(0, 10) };
      failed++;
      console.log(`FAILED: ${r.error}`);
    }
  } catch (e) {
    prev.results[code] = { name: entry.name, status: "failed", error: e.message, date: new Date().toISOString().slice(0, 10) };
    failed++;
    console.log(`FAILED: ${e.message}`);
  }
}

prev.date_updated = new Date().toISOString().slice(0, 10);
prev.provider = provider;
prev.model = model;
prev.samples = SAMPLES;
writeFileSync(outFile, JSON.stringify(prev, null, 2) + "\n");
console.log(`\nverified: ${verified}, failed: ${failed} -> ${outFile}`);
