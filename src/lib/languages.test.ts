import test from "node:test";
import assert from "node:assert/strict";
import {
  LANGUAGE_REGISTRY,
  LANGUAGES,
  PRODUCTION_TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGES,
  findLanguage,
} from "../../supabase/functions/_shared/languages.ts";

test("registry has unique BCP-47/ISO-639 codes", () => {
  const codes = LANGUAGE_REGISTRY.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.match(c, /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/);
});

test("every entry carries script, direction and a translation tier", () => {
  for (const l of LANGUAGE_REGISTRY) {
    assert.ok(l.script, `missing script: ${l.code}`);
    assert.ok(l.dir === "ltr" || l.dir === "rtl", `bad dir: ${l.code}`);
    assert.ok(l.translation === "llm" || l.translation === "llm-experimental");
  }
});

test("RTL scripts are marked right-to-left", () => {
  for (const l of LANGUAGE_REGISTRY) {
    if (l.script === "Arab" || l.script === "Hebr") assert.equal(l.dir, "rtl", l.code);
  }
  assert.equal(findLanguage("ar")!.dir, "rtl");
  assert.equal(findLanguage("he")!.dir, "rtl");
  assert.equal(findLanguage("fa")!.dir, "rtl");
});

test("African coverage: the five regions and Ghanaian priority languages", () => {
  const codes = new Set(LANGUAGE_REGISTRY.map((l) => l.code));
  // West/Ghana
  for (const c of ["ak", "ee", "gaa", "ha", "yo", "ig", "ff", "wo", "bm", "mos", "fon"]) assert.ok(codes.has(c), c);
  // Ghanaian priority set (production + experimental)
  for (const c of ["ak", "ee", "gaa", "dag", "ada", "dga", "kac", "kus", "gur", "mpm", "gjn", "nzi"]) {
    assert.ok(codes.has(c), `Ghanaian language missing: ${c}`);
  }
  // East
  for (const c of ["sw", "am", "om", "ti", "so", "rw", "rn", "lg", "ki", "luo"]) assert.ok(codes.has(c), c);
  // Central
  for (const c of ["ln", "kg", "sg", "lua", "fan"]) assert.ok(codes.has(c), c);
  // Southern
  for (const c of ["zu", "xh", "sn", "st", "tn", "ts", "ve", "ss", "nd", "ny", "bem", "af"]) assert.ok(codes.has(c), c);
  // North
  for (const c of ["ar", "ber", "kab", "shi"]) assert.ok(codes.has(c), c);
});

test("experimental tier is flagged and never presented as transcription-capable", () => {
  const experimental = LANGUAGE_REGISTRY.filter((l) => l.translation === "llm-experimental");
  assert.ok(experimental.length > 0);
  for (const l of experimental) {
    assert.equal(l.transcription, false, `${l.code} must not claim transcription`);
    assert.ok(!LANGUAGES.some((x) => x.code === l.code), `${l.code} must not be in the STT list`);
  }
});

test("derived lists keep the historical shapes", () => {
  for (const l of LANGUAGES) {
    assert.ok(typeof l.code === "string" && typeof l.name === "string");
  }
  assert.ok(TRANSLATION_LANGUAGES.length >= LANGUAGES.length);
  assert.equal(
    PRODUCTION_TRANSLATION_LANGUAGES.length,
    TRANSLATION_LANGUAGES.length - LANGUAGE_REGISTRY.filter((l) => l.translation === "llm-experimental").length,
  );
  // The transcription list is a subset of the translation list.
  const trans = new Set(TRANSLATION_LANGUAGES.map((l) => l.code));
  for (const l of LANGUAGES) assert.ok(trans.has(l.code), l.code);
});

test("Twi, Ewe and Ga are production-tier translations (verified provider path)", () => {
  // Twi was verified live through the provider on 2026-10-30.
  assert.equal(findLanguage("ak")!.translation, "llm");
  assert.equal(findLanguage("ee")!.translation, "llm");
  assert.equal(findLanguage("gaa")!.translation, "llm");
});

test("Akan/Twi carries its native name and Ghana region", () => {
  const ak = findLanguage("ak")!;
  assert.equal(ak.native, "Akan");
  assert.ok(ak.regions!.includes("GH"));
  assert.equal(ak.script, "Latn");
});
