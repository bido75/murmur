// Searchable language selection: pure filter/sort logic, tested under Node.
// Used by the recording screen's translate picker (and reusable for the STT
// language picker in settings).

import { LANGUAGE_REGISTRY, type LanguageEntry } from "../../supabase/functions/_shared/languages.ts";

/** Lowercase and strip Latin combining diacritics so "yoruba" matches "Yorùbá".
 *  African base letters (ɛ ɔ ŋ ʋ ɖ) are not combining marks — search matches
 *  them only when typed, so English-name search stays the primary path. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export type PickerSection = {
  key: string;
  label: string | null;
  entries: LanguageEntry[];
};

/**
 * Build the picker sections for a query:
 *  1. Recent (the user's last languages, newest first, capped)
 *  2. All languages alphabetically (production tier first is NOT applied —
 *     alphabetical keeps discovery predictable; experimental entries carry
 *     their "(experimental)" label from the caller).
 * Matching is against the English name, the native name and the code.
 */
export function buildPickerSections(
  query: string,
  recentCodes: string[],
): PickerSection[] {
  const q = fold(query);
  const match = (l: LanguageEntry) =>
    !q ||
    fold(l.name).includes(q) ||
    (l.native ? fold(l.native).includes(q) : false) ||
    fold(l.code).includes(q);

  const sections: PickerSection[] = [];
  const seen = new Set<string>();

  const recent = recentCodes
    .map((code) => LANGUAGE_REGISTRY.find((l) => l.code === code))
    .filter((l): l is LanguageEntry => !!l && match(l));
  if (recent.length) {
    sections.push({
      key: "recent",
      label: "Recently used",
      entries: recent.slice(0, 4),
    });
    recent.forEach((l) => seen.add(l.code));
  }

  const rest = LANGUAGE_REGISTRY.filter((l) => match(l) && !seen.has(l.code)).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  if (rest.length) sections.push({ key: "all", label: null, entries: rest });
  return sections;
}

/** Persisted recently-used translate languages (newest first, max 4). */
export function pushRecent(codes: string[], code: string, max = 4): string[] {
  return [code, ...codes.filter((c) => c !== code)].slice(0, max);
}
