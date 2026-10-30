// The words the app should hear.
//
// A name, a product, an acronym: the model hears it wrongly because it has never
// heard it before. A dictionary lists the words, and the clean-up puts the right
// spelling back.
//
// The rule that matters: a word the model was sure about is left alone. If the model
// heard "clear" and was confident, that is what was said; quietly changing it to a
// name in the dictionary would be wrong.

/** A word in the dictionary. */
export type DictionaryEntry = {
  /** The word, as it should be written. */
  word: string;
  /** How sure the model has to be for the word to be left alone. */
  confidence?: number;
};

/** The most the dictionary will guess. */
export const MAX_DICTIONARY_WORDS = 500;

/**
 * Check a word before it is added.
 */
export function validateEntry(word: string): { ok: boolean; reason?: string } {
  const trimmed = word.trim();
  if (!trimmed) return { ok: false, reason: "The word cannot be empty." };
  if (/\d/.test(trimmed))
    return { ok: false, reason: "Numbers are not supported in the dictionary." };
  if (trimmed.split(/\s+/).length > 2)
    return { ok: false, reason: "Use one word, or two." };
  return { ok: true };
}

/**
 * Add a word, without a duplicate.
 *
 * The same word in a different case is the same word.
 */
export function addEntry(
  entries: DictionaryEntry[],
  word: string,
): { entries: DictionaryEntry[]; added: boolean; reason?: string } {
  const check = validateEntry(word);
  if (!check.ok) return { entries, added: false, reason: check.reason };
  const trimmed = word.trim();
  const exists = entries.some(
    (e) => e.word.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exists)
    return { entries, added: false, reason: "That word is already in the dictionary." };
  return { entries: [...entries, { word: trimmed }], added: true };
}

/** Take a word out. */
export function removeEntry(
  entries: DictionaryEntry[],
  word: string,
): DictionaryEntry[] {
  return entries.filter((e) => e.word.toLowerCase() !== word.toLowerCase());
}

/**
 * The words, in the order they are shown: alphabetically, ignoring case.
 */
export function sortedEntries(entries: DictionaryEntry[]): DictionaryEntry[] {
  return [...entries].sort((a, b) =>
    a.word.localeCompare(b.word, undefined, { sensitivity: "base" }),
  );
}

/** How many words are in a passage, and how sure the model was about each. */
export type WordConfidence = {
  text: string;
  confidence: number;
};

/**
 * Split a passage into words with the model's confidence in each.
 *
 * The words are split on anything that is not a letter or a digit, so "front-end"
 * and "end" are two words, and the apostrophe in "don't" is not.
 */
export function wordsWithConfidence(
  words: WordConfidence[],
): { text: string; confidence: number }[] {
  const out: { text: string; confidence: number }[] = [];
  for (const w of words) {
    const parts = w.text.split(/(\p{L}[\p{L}\p{N}]*)/u).filter(Boolean);
    for (const part of parts) {
      if (!/\p{L}/u.test(part)) continue;
      out.push({ text: part, confidence: w.confidence });
    }
  }
  return out;
}

/**
 * How far one word is from another.
 *
 * The number of single-character changes needed to turn one into the other.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length];
}

/**
 * How far apart two words may be and still be the same word.
 *
 * A short word has to match exactly; a long one may be a letter out.
 */
export function maxEditDistance(word: string): number {
  const n = word.length;
  if (n <= 3) return 0;
  if (n <= 7) return 1;
  return 2;
}

/** How sure the model has to be for a word to be left alone. */
export const CONFIDENCE_THRESHOLD = 0.45;

/**
 * Put the dictionary's spelling back.
 *
 * A word the model was sure about is not touched: if it is sure of "clear", that is
 * what was said. Only a word it was unsure about is matched against the dictionary.
 */
export function applyDictionary(
  words: WordConfidence[],
  entries: DictionaryEntry[],
): WordConfidence[] {
  if (!entries.length) return words;
  const lookup = new Map(
    entries.map((e) => [e.word.toLowerCase(), e.word]),
  );
  return words.map((w) => {
    const key = w.text.toLowerCase();
    // An exact match always gets the dictionary's spelling and capitalisation.
    const exact = lookup.get(key);
    if (exact) return { ...w, text: exact };
    // Otherwise the word has to be close, and the model has to have been unsure.
    if (w.confidence >= CONFIDENCE_THRESHOLD) return w;
    let best: { word: string; distance: number } | null = null;
    for (const entry of entries) {
      const candidate = entry.word.toLowerCase();
      const limit = maxEditDistance(candidate);
      if (Math.abs(candidate.length - key.length) > limit) continue;
      const distance = editDistance(candidate, key);
      if (distance > limit) continue;
      if (!best || distance < best.distance) best = { word: entry.word, distance };
    }
    // Two words equally close means the model was not sure, so nothing is changed.
    if (!best || best.distance === 0) return w;
    return { ...w, text: best.word };
  });
}

/**
 * Read a dictionary from a text file: one word per line.
 *
 * A file that has the same word twice keeps one copy.
 */
export function parseDictionaryFile(text: string): {
  entries: DictionaryEntry[];
  skipped: string[];
} {
  const entries: DictionaryEntry[] = [];
  const skipped: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim();
    if (!word) continue;
    const check = validateEntry(word);
    if (!check.ok) {
      skipped.push(word);
      continue;
    }
    if (entries.some((e) => e.word.toLowerCase() === word.toLowerCase()))
      continue;
    entries.push({ word });
  }
  return { entries, skipped };
}

/** A dictionary as a text file: one word per line. */
export function formatDictionaryFile(entries: DictionaryEntry[]): string {
  return sortedEntries(entries)
    .map((e) => e.word)
    .join("\n");
}
