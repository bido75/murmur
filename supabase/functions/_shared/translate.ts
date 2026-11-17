// Translation helpers. Pure; tested.

// The language registry is the single source of truth for both the app and the
// Edge Functions. The two exports below keep the historical shapes stable.
export {
  LANGUAGES,
  LANGUAGE_REGISTRY,
  PRODUCTION_TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGES,
  findLanguage,
  type LanguageEntry,
} from "./languages.ts";


export const TRANSLATE_TOOL = {
  name: 'translated',
  description: 'Return the translated lines.',
  input_schema: {
    type: 'object',
    properties: { lines: { type: 'array', items: { type: 'string' }, description: 'One translated line per input line, same order, same count.' } },
    required: ['lines'],
  },
} as const;

export function translateSystem(language: string): string {
  return [
    `Translate each line into ${language}.`,
    'Return exactly one output line per input line, in the same order. Keep empty lines empty.',
    'Keep names, product names, numbers, dates and units exactly as they are. Keep tags like [PII] unchanged.',
    'Translate meaning naturally; do not add or remove information.',
  ].join('\n');
}

/** Split lines into chunks of at most `maxLines` lines and about `maxChars` characters. */
export function chunkLines(lines: string[], maxLines = 120, maxChars = 12000): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length && (cur.length >= maxLines || size + l.length > maxChars)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.length;
  }
  if (cur.length) out.push(cur);
  return out;
}
