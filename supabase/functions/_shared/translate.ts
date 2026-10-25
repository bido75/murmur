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

/**
 * The languages the notes can be translated into.
 *
 * This is LANGUAGES plus the many languages a model can write that a speech engine
 * may not recognise, so translation has the full spread (including the major
 * languages of Africa) while LANGUAGES stays as the speech engine's own list.
 */
export const TRANSLATION_LANGUAGES: { code: string; name: string }[] = [
  ...LANGUAGES,
  // Africa — North
  { code: 'ar-DZ', name: 'Algerian Arabic' }, { code: 'ar-MA', name: 'Moroccan Arabic (Darija)' },
  { code: 'ar-EG', name: 'Egyptian Arabic' }, { code: 'ar-TN', name: 'Tunisian Arabic' },
  { code: 'ber', name: 'Tamazight (Berber)' }, { code: 'kab', name: 'Kabyle' }, { code: 'shi', name: 'Tachelhit' },
  // Africa — West
  { code: 'ha', name: 'Hausa' }, { code: 'yo', name: 'Yoruba' }, { code: 'ig', name: 'Igbo' },
  { code: 'ff', name: 'Fula (Fulfulde)' }, { code: 'ak', name: 'Twi (Akan)' }, { code: 'ee', name: 'Ewe' },
  { code: 'gaa', name: 'Ga' }, { code: 'wo', name: 'Wolof' }, { code: 'bm', name: 'Bambara' },
  { code: 'mos', name: 'Moore' }, { code: 'fon', name: 'Fon' },
  // Africa — Central
  { code: 'ln', name: 'Lingala' }, { code: 'kg', name: 'Kikongo' }, { code: 'sg', name: 'Sango' },
  { code: 'lua', name: 'Tshiluba' }, { code: 'fan', name: 'Fang' },
  // Africa — East
  { code: 'sw', name: 'Swahili' }, { code: 'am', name: 'Amharic' }, { code: 'om', name: 'Oromo' },
  { code: 'ti', name: 'Tigrinya' }, { code: 'so', name: 'Somali' }, { code: 'rw', name: 'Kinyarwanda' },
  { code: 'rn', name: 'Kirundi' }, { code: 'lg', name: 'Luganda' }, { code: 'ki', name: 'Kikuyu' },
  { code: 'luo', name: 'Dholuo' }, { code: 'mg', name: 'Malagasy' },
  // Africa — Southern
  { code: 'af', name: 'Afrikaans' }, { code: 'zu', name: 'Zulu' }, { code: 'xh', name: 'Xhosa' },
  { code: 'sn', name: 'Shona' }, { code: 'st', name: 'Sesotho' }, { code: 'tn', name: 'Setswana' },
  { code: 'ts', name: 'Tsonga' }, { code: 've', name: 'Venda' }, { code: 'ss', name: 'Swati' },
  { code: 'nd', name: 'Ndebele' }, { code: 'ny', name: 'Chichewa' }, { code: 'bem', name: 'Bemba' },
  // Asia and Oceania
  { code: 'fa', name: 'Persian' }, { code: 'ur', name: 'Urdu' }, { code: 'pa', name: 'Punjabi' },
  { code: 'mr', name: 'Marathi' }, { code: 'gu', name: 'Gujarati' }, { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' }, { code: 'kn', name: 'Kannada' }, { code: 'ml', name: 'Malayalam' },
  { code: 'ne', name: 'Nepali' }, { code: 'si', name: 'Sinhala' }, { code: 'my', name: 'Burmese' },
  { code: 'km', name: 'Khmer' }, { code: 'lo', name: 'Lao' }, { code: 'ms', name: 'Malay' },
  { code: 'jv', name: 'Javanese' }, { code: 'mn', name: 'Mongolian' }, { code: 'kk', name: 'Kazakh' },
  { code: 'uz', name: 'Uzbek' }, { code: 'ps', name: 'Pashto' }, { code: 'ku', name: 'Kurdish' },
  // Europe and beyond
  { code: 'sq', name: 'Albanian' }, { code: 'bs', name: 'Bosnian' }, { code: 'hr', name: 'Croatian' },
  { code: 'sr', name: 'Serbian' }, { code: 'bg', name: 'Bulgarian' }, { code: 'mk', name: 'Macedonian' },
  { code: 'sk', name: 'Slovak' }, { code: 'sl', name: 'Slovenian' }, { code: 'lt', name: 'Lithuanian' },
  { code: 'lv', name: 'Latvian' }, { code: 'et', name: 'Estonian' }, { code: 'is', name: 'Icelandic' },
  { code: 'hy', name: 'Armenian' }, { code: 'ka', name: 'Georgian' }, { code: 'az', name: 'Azerbaijani' },
  { code: 'ht', name: 'Haitian Creole' },
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
