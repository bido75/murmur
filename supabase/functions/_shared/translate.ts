// Translation helpers. Pure; tested.

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }, { code: 'fr', name: 'French' }, { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' }, { code: 'pt', name: 'Portuguese' }, { code: 'nl', name: 'Dutch' }, { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian' }, { code: 'uk', name: 'Ukrainian' }, { code: 'tr', name: 'Turkish' }, { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' }, { code: 'hi', name: 'Hindi' }, { code: 'bn', name: 'Bengali' }, { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' }, { code: 'ja', name: 'Japanese' }, { code: 'ko', name: 'Korean' }, { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' }, { code: 'id', name: 'Indonesian' }, { code: 'tl', name: 'Tagalog' }, { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' }, { code: 'no', name: 'Norwegian' }, { code: 'fi', name: 'Finnish' }, { code: 'el', name: 'Greek' },
  { code: 'cs', name: 'Czech' }, { code: 'ro', name: 'Romanian' }, { code: 'hu', name: 'Hungarian' },
];

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
