import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  looksLikeMojibake,
  repairMojibake,
  normalizeEncodingArtifacts,
  MOJIBAKE_SIGNATURES,
} from "./mojibake.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("repairs the exact mojibake sequences observed in production", () => {
  assert.equal(repairMojibake("Meeting summary â€¢ key points"), "Meeting summary • key points");
  assert.equal(repairMojibake("Loadingâ€¦"), "Loading…");
  assert.equal(repairMojibake("Item Â· Item"), "Item · Item");
  assert.equal(repairMojibake("Full name â€” required"), "Full name — required");
  assert.equal(repairMojibake("Donâ€™t delete"), "Don’t delete");
  assert.equal(repairMojibake('Field "Name" â€œquotedâ€\u009D'), 'Field "Name" “quoted”');
  assert.equal(repairMojibake("CafÃ© renÃ©e"), "Café renée");
  assert.equal(repairMojibake("SeÃ±or MÃ¼ller"), "Señor Müller");
  assert.equal(repairMojibake("KÃ¶ln straÃŸe"), "Köln straße");
});

test("preserves correctly encoded multilingual text unchanged", () => {
  const samples = [
    "Bullet • separator · dash — apostrophe ’ ellipsis …",
    "Café résumé naïve façade groß straße",
    "مرحبا بالعالم", // Arabic
    "你好世界", // Chinese
    "こんにちは世界", // Japanese
    "नमस्ते दुनिया", // Hindi
    "Habari ya dunia", // Swahili
    "ሰላም ልዑል", // Amharic
    "Akwaaba, ɛte sɛn?", // Akan/Twi
    "Woe zɔ, mi deo?", // Ewe
    "Ελα πλαίσιο", // Greek
    "Привіт світ", // Ukrainian
    "Türkçe İı Şş Ğğ Çç Öö Üü",
    "Em dash — en dash – curly “quotes” ‘single’",
  ];
  for (const s of samples) {
    assert.equal(looksLikeMojibake(s), false, `false positive on: ${s}`);
    assert.equal(repairMojibake(s), s, `mutated: ${s}`);
  }
});

test("repairs mixed content without touching legitimate accents", () => {
  const mixed = "Café â€¢ notes â€” naÃ¯ve";
  const repaired = repairMojibake(mixed);
  assert.equal(repaired, "Café • notes — naïve");
});

test("normalizeEncodingArtifacts strips invisible characters only", () => {
  assert.equal(normalizeEncodingArtifacts("a\u200Bb\u00A0c"), "ab c");
  assert.equal(normalizeEncodingArtifacts("مرحبا\u200D"), "مرحبا");
  assert.equal(normalizeEncodingArtifacts("Café"), "Café");
});

test("full-stream reversal handles pure double-encoded content", () => {
  const pure = "Toplanti Ã¶zeti â€¢ kayit â€” tamam";
  assert.equal(repairMojibake(pure), "Toplanti özeti • kayit — tamam");
});

test("no app source file contains mojibake signatures (repo-wide guard)", () => {
  const roots = [join(here, "..")]; // src/
  const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".json"]);
  const skipDirs = new Set(["node_modules", ".expo", "dist-web", "build"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (!skipDirs.has(name)) walk(p);
        continue;
      }
      if (!exts.has(name.slice(name.lastIndexOf(".")))) continue;
      if (p === join(here, "mojibake.ts") || p === join(here, "mojibake.test.ts")) continue;
      const content = readFileSync(p, "utf8");
      if (MOJIBAKE_SIGNATURES.some((sig) => content.includes(sig))) {
        offenders.push(p);
      }
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(offenders, [], `mojibake signatures found in: ${offenders.join(", ")}`);
});
