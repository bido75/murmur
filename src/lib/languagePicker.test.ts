import test from "node:test";
import assert from "node:assert/strict";
import { buildPickerSections, fold, pushRecent } from "./languagePicker.ts";
import { LANGUAGE_REGISTRY } from "../../supabase/functions/_shared/languages.ts";

test("fold strips Latin diacritics but keeps African base letters", () => {
  assert.equal(fold("Yorùbá"), "yoruba");
  assert.equal(fold("Français"), "francais");
  // ɛ and ɔ are base letters in African orthography, not combining marks.
  assert.equal(fold("Ɛte"), "ɛte");
});

test("search matches English name, native name and code", () => {
  const q = (s: string) => buildPickerSections(s, [])[0]?.entries.map((l) => l.code) ?? [];
  assert.ok(q("yoruba").includes("yo")); // folded native match
  assert.ok(q("swahili").includes("sw"));
  // "Eʋegbe" folds to "evegbe" (ʋ is a base letter, not a combining mark) —
  // searching "esw" does NOT match it; English-name search is the primary path.
  assert.ok(!q("esw").includes("ee"));
});

test("search: code and native-name matching", () => {
  const q = (s: string) => buildPickerSections(s, [])[0]?.entries.map((l) => l.code) ?? [];
  assert.ok(q("twi").includes("ak")); // English name contains "Twi (Akan)"
  assert.ok(q("ewe").includes("ee"));
  assert.ok(q("aka").includes("ak")); // native "Akan"
  assert.ok(q("fr").includes("fr")); // code
});

test("recent languages appear first and respect the query", () => {
  const sections = buildPickerSections("", ["yo", "fr"]);
  assert.equal(sections[0].key, "recent");
  assert.equal(sections[0].entries[0].code, "yo");
  // A query that excludes recents drops the section rather than showing junk.
  const filtered = buildPickerSections("swahili", ["yo"]);
  assert.equal(filtered.find((s) => s.key === "recent"), undefined);
  assert.ok(filtered[0].entries.some((l) => l.code === "sw"));
});

test("pushRecent is newest-first, de-duplicated, capped at 4", () => {
  let codes = pushRecent([], "fr");
  codes = pushRecent(codes, "yo");
  codes = pushRecent(codes, "fr"); // duplicate moves to front
  assert.deepEqual(codes, ["fr", "yo"]);
  codes = pushRecent(codes, "sw");
  codes = pushRecent(codes, "ar");
  codes = pushRecent(codes, "de"); // newest
  assert.equal(codes.length, 4);
  codes = pushRecent(codes, "ig"); // evicts the oldest ("fr")
  assert.equal(codes.length, 4);
  assert.equal(codes[0], "ig");
  assert.ok(!codes.includes("fr"));
});

test("empty query lists the full registry alphabetically", () => {
  const sections = buildPickerSections("", []);
  const all = sections.flatMap((s) => s.entries);
  assert.equal(all.length, LANGUAGE_REGISTRY.length);
  const names = all.map((l) => l.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});
