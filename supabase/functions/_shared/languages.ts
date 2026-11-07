// Central language registry shared by the app (web/Android/desktop) and the
// Edge Functions. Supersedes the two flat lists in translate.ts, which now
// re-export from here so clients and functions never drift.
//
// Capability rules (honest by design):
//  - translation: "llm" — the configured LLM provider translates into this
//    language (verified live for Twi 2026-10-30; other languages use the same
//    provider but per-language quality is UNVERIFIED until the capability
//    matrix is run).
//  - translation: "llm-experimental" — low-resource languages where an LLM can
//    produce output but quality is not established. The UI must label these
//    experimental; they are NOT production-ready claims.
//  - transcription: true — the configured STT provider's own language list
//    includes it (LANGUAGES below). A language must never be shown as
//    transcription-capable based on translation alone.
//  - Codes follow BCP-47/ISO-639 where a verified code exists. Languages
//    without a verified code stay on the research backlog (see
//    docs/multilingual/12-GHANAIAN-LANGUAGE-COVERAGE.md), not in this file.

export type Direction = "ltr" | "rtl";

export type LanguageEntry = {
  /** BCP-47 / ISO-639 code. */
  code: string;
  /** English name. */
  name: string;
  /** Native (endonym) name, where verified; omit otherwise. */
  native?: string;
  /** ISO 15924 script code (rendering hint: fonts, fallback). */
  script: string;
  dir: Direction;
  /** Major ISO-3166 regions where the language is spoken. */
  regions?: string[];
  /** Translation capability tier. */
  translation: "llm" | "llm-experimental";
  /** Whether the configured STT provider list includes this language. */
  transcription: boolean;
};

const L = (
  code: string,
  name: string,
  script: string,
  extra?: Partial<Omit<LanguageEntry, "code" | "name" | "script">> & { transcription?: boolean },
): LanguageEntry => ({
  code,
  name,
  script,
  dir: script === "Arab" || script === "Hebr" ? "rtl" : "ltr",
  translation: "llm",
  transcription: false,
  ...extra,
});

// --- Speech-engine list (transcription: true) -------------------------------

export const LANGUAGE_REGISTRY: LanguageEntry[] = [
  L("en", "English", "Latn", { native: "English", transcription: true, regions: ["US", "GB", "NG", "GH", "KE", "ZA"] }),
  L("es", "Spanish", "Latn", { native: "Español", transcription: true, regions: ["ES", "MX", "AR", "CO"] }),
  L("fr", "French", "Latn", { native: "Français", transcription: true, regions: ["FR", "SN", "CI", "CM", "CD"] }),
  L("de", "German", "Latn", { native: "Deutsch", transcription: true }),
  L("it", "Italian", "Latn", { native: "Italiano", transcription: true }),
  L("pt", "Portuguese", "Latn", { native: "Português", transcription: true, regions: ["PT", "BR", "AO", "MZ"] }),
  L("nl", "Dutch", "Latn", { native: "Nederlands", transcription: true }),
  L("pl", "Polish", "Latn", { native: "Polski", transcription: true }),
  L("ru", "Russian", "Cyrl", { native: "Русский", transcription: true }),
  L("uk", "Ukrainian", "Cyrl", { native: "Українська", transcription: true }),
  L("tr", "Turkish", "Latn", { native: "Türkçe", transcription: true }),
  L("ar", "Arabic", "Arab", { native: "العربية", dir: "rtl", transcription: true, regions: ["SA", "EG", "MA", "DZ", "AE"] }),
  L("he", "Hebrew", "Hebr", { native: "עברית", dir: "rtl", transcription: true }),
  L("hi", "Hindi", "Deva", { native: "हिन्दी", transcription: true }),
  L("bn", "Bengali", "Beng", { native: "বাংলা", transcription: true }),
  L("zh", "Chinese (Simplified)", "Hans", { native: "简体中文", transcription: true }),
  L("zh-TW", "Chinese (Traditional)", "Hant", { native: "繁體中文", transcription: true }),
  L("ja", "Japanese", "Jpan", { native: "日本語", transcription: true }),
  L("ko", "Korean", "Hang", { native: "한국어", transcription: true }),
  L("vi", "Vietnamese", "Latn", { native: "Tiếng Việt", transcription: true }),
  L("th", "Thai", "Thai", { native: "ไทย", transcription: true }),
  L("id", "Indonesian", "Latn", { native: "Bahasa Indonesia", transcription: true }),
  L("tl", "Tagalog", "Latn", { native: "Tagalog", transcription: true }),
  L("sv", "Swedish", "Latn", { native: "Svenska", transcription: true }),
  L("da", "Danish", "Latn", { native: "Dansk", transcription: true }),
  L("no", "Norwegian", "Latn", { native: "Norsk", transcription: true }),
  L("fi", "Finnish", "Latn", { native: "Suomi", transcription: true }),
  L("el", "Greek", "Grek", { native: "Ελληνικά", transcription: true }),
  L("cs", "Czech", "Latn", { native: "Čeština", transcription: true }),
  L("ro", "Romanian", "Latn", { native: "Română", transcription: true }),
  L("hu", "Hungarian", "Latn", { native: "Magyar", transcription: true }),

  // --- Africa — North -------------------------------------------------------
  L("ar-DZ", "Algerian Arabic", "Arab", { dir: "rtl", regions: ["DZ"] }),
  L("ar-MA", "Moroccan Arabic (Darija)", "Arab", { dir: "rtl", regions: ["MA"] }),
  L("ar-EG", "Egyptian Arabic", "Arab", { native: "مصري", dir: "rtl", regions: ["EG"] }),
  L("ar-TN", "Tunisian Arabic", "Arab", { dir: "rtl", regions: ["TN"] }),
  L("ber", "Tamazight (Berber)", "Tfng", { regions: ["DZ", "MA"] }),
  L("kab", "Kabyle", "Latn", { regions: ["DZ"] }),
  L("shi", "Tachelhit", "Tfng", { regions: ["MA"] }),

  // --- Africa — West --------------------------------------------------------
  L("ha", "Hausa", "Latn", { native: "Hausa", regions: ["NG", "NE", "GH"] }),
  L("yo", "Yoruba", "Latn", { native: "Yorùbá", regions: ["NG", "BJ"] }),
  L("ig", "Igbo", "Latn", { native: "Igbo", regions: ["NG"] }),
  L("ff", "Fula (Fulfulde)", "Latn", { native: "Fulfulde", regions: ["SN", "GN", "ML", "NG", "CM"] }),
  L("ak", "Twi (Akan)", "Latn", { native: "Akan", regions: ["GH"] }),
  L("ee", "Ewe", "Latn", { native: "Eʋegbe", regions: ["GH", "TG"] }),
  L("gaa", "Ga", "Latn", { native: "Gã", regions: ["GH"] }),
  L("wo", "Wolof", "Latn", { native: "Wolof", regions: ["SN", "GM"] }),
  L("bm", "Bambara", "Latn", { native: "Bamanankan", regions: ["ML"] }),
  L("mos", "Moore", "Latn", { regions: ["BF"] }),
  L("fon", "Fon", "Latn", { regions: ["BJ"] }),

  // --- Africa — Central -----------------------------------------------------
  L("ln", "Lingala", "Latn", { regions: ["CD", "CG"] }),
  L("kg", "Kikongo", "Latn", { regions: ["CD", "CG"] }),
  L("sg", "Sango", "Latn", { regions: ["CF"] }),
  L("lua", "Tshiluba", "Latn", { regions: ["CD"] }),
  L("fan", "Fang", "Latn", { regions: ["GQ", "GA", "CM"] }),

  // --- Africa — East --------------------------------------------------------
  L("sw", "Swahili", "Latn", { native: "Kiswahili", regions: ["KE", "TZ", "UG", "RW", "CD"] }),
  L("am", "Amharic", "Ethi", { native: "አማርኛ", regions: ["ET"] }),
  L("om", "Oromo", "Latn", { native: "Afaan Oromoo", regions: ["ET"] }),
  L("ti", "Tigrinya", "Ethi", { native: "ትግርኛ", regions: ["ER", "ET"] }),
  L("so", "Somali", "Latn", { native: "Soomaali", regions: ["SO", "DJ", "ET"] }),
  L("rw", "Kinyarwanda", "Latn", { native: "Ikinyarwanda", regions: ["RW"] }),
  L("rn", "Kirundi", "Latn", { native: "Ikirundi", regions: ["BI"] }),
  L("lg", "Luganda", "Latn", { native: "Luganda", regions: ["UG"] }),
  L("ki", "Kikuyu", "Latn", { native: "Gĩkũyũ", regions: ["KE"] }),
  L("luo", "Dholuo", "Latn", { regions: ["KE", "TZ"] }),
  L("mg", "Malagasy", "Latn", { regions: ["MG"] }),

  // --- Africa — Southern ----------------------------------------------------
  L("af", "Afrikaans", "Latn", { regions: ["ZA", "NA"] }),
  L("zu", "Zulu", "Latn", { native: "isiZulu", regions: ["ZA"] }),
  L("xh", "Xhosa", "Latn", { native: "isiXhosa", regions: ["ZA"] }),
  L("sn", "Shona", "Latn", { native: "chiShona", regions: ["ZW"] }),
  L("st", "Sesotho", "Latn", { regions: ["LS", "ZA"] }),
  L("tn", "Setswana", "Latn", { regions: ["BW", "ZA"] }),
  L("ts", "Tsonga", "Latn", { native: "Xitsonga", regions: ["ZA", "MZ"] }),
  L("ve", "Venda", "Latn", { native: "Tshivenda", regions: ["ZA"] }),
  L("ss", "Swati", "Latn", { regions: ["SZ", "ZA"] }),
  L("nd", "Ndebele", "Latn", { regions: ["ZW", "ZA"] }),
  L("ny", "Chichewa", "Latn", { native: "Chichewa", regions: ["MW", "ZM"] }),
  L("bem", "Bemba", "Latn", { regions: ["ZM"] }),

  // --- Asia -----------------------------------------------------------------
  L("fa", "Persian", "Arab", { native: "فارسی", dir: "rtl" }),
  L("ur", "Urdu", "Arab", { native: "اردو", dir: "rtl" }),
  L("pa", "Punjabi", "Guru", { native: "ਪੰਜਾਬੀ" }),
  L("mr", "Marathi", "Deva", { native: "मराठी" }),
  L("gu", "Gujarati", "Gujr", { native: "ગુજરાતી" }),
  L("ta", "Tamil", "Taml", { native: "தமிழ்" }),
  L("te", "Telugu", "Telu", { native: "తెలుగు" }),
  L("kn", "Kannada", "Knda", { native: "ಕನ್ನಡ" }),
  L("ml", "Malayalam", "Mlym", { native: "മലയാളം" }),
  L("ne", "Nepali", "Deva", { native: "नेपाली" }),
  L("si", "Sinhala", "Sinh", { native: "සිංහල" }),
  L("my", "Burmese", "Mymr", { native: "မြန်မာ" }),
  L("km", "Khmer", "Khmr", { native: "ខ្មែរ" }),
  L("lo", "Lao", "Laoo", { native: "ລາວ" }),
  L("ms", "Malay", "Latn", { native: "Bahasa Melayu" }),
  L("jv", "Javanese", "Latn", { native: "Basa Jawa" }),
  L("mn", "Mongolian", "Cyrl", { native: "Монгол" }),
  L("kk", "Kazakh", "Cyrl", { native: "Қазақ" }),
  L("uz", "Uzbek", "Latn", { native: "Oʻzbek" }),
  L("ps", "Pashto", "Arab", { native: "پښتو", dir: "rtl" }),
  L("ku", "Kurdish", "Arab", { native: "کوردی", dir: "rtl" }),

  // --- Europe and beyond ----------------------------------------------------
  L("sq", "Albanian", "Latn", { native: "Shqip" }),
  L("bs", "Bosnian", "Latn", { native: "Bosanski" }),
  L("hr", "Croatian", "Latn", { native: "Hrvatski" }),
  L("sr", "Serbian", "Latn", { native: "Српски" }),
  L("bg", "Bulgarian", "Cyrl", { native: "Български" }),
  L("mk", "Macedonian", "Cyrl", { native: "Македонски" }),
  L("sk", "Slovak", "Latn", { native: "Slovenčina" }),
  L("sl", "Slovenian", "Latn", { native: "Slovenščina" }),
  L("lt", "Lithuanian", "Latn", { native: "Lietuvių" }),
  L("lv", "Latvian", "Latn", { native: "Latviešu" }),
  L("et", "Estonian", "Latn", { native: "Eesti" }),
  L("is", "Icelandic", "Latn", { native: "Íslenska" }),
  L("hy", "Armenian", "Armn", { native: "Հայերեն" }),
  L("ka", "Georgian", "Geor", { native: "ქართული" }),
  L("az", "Azerbaijani", "Latn", { native: "Azərbaycan" }),
  L("ht", "Haitian Creole", "Latn", { native: "Kreyòl Ayisyen", regions: ["HT"] }),

  // --- Africa — additions from the worldwide coverage mandate ----------------
  L("mnk", "Mandinka", "Latn", { regions: ["GM", "SN", "GN"] }),
  L("kr", "Kanuri", "Arab", { regions: ["NG", "NE", "TD"] }),
  L("kri", "Krio", "Latn", { regions: ["SL"] }),
  L("men", "Mende", "Latn", { regions: ["SL"] }),
  L("mas", "Maasai (Maa)", "Latn", { regions: ["KE", "TZ"] }),
  L("ktu", "Kituba", "Latn", { regions: ["CD", "CG"] }),
  L("ewo", "Ewondo", "Latn", { regions: ["CM"] }),
  L("dua", "Duala", "Latn", { regions: ["CM"] }),
  L("lol", "Mongo (Lomongo)", "Latn", { regions: ["CD"] }),
  L("rif", "Tarifit", "Tfng", { regions: ["MA", "NL"] }),
  L("mey", "Hassaniya Arabic", "Arab", { dir: "rtl", regions: ["MR", "EH"] }),
  L("nso", "Sepedi (Northern Sotho)", "Latn", { regions: ["ZA"] }),
  L("loz", "Lozi", "Latn", { regions: ["ZM", "NA"] }),

  // --- Europe — additions -----------------------------------------------------
  L("ga", "Irish", "Latn", { native: "Gaeilge", regions: ["IE"] }),
  L("cy", "Welsh", "Latn", { native: "Cymraeg", regions: ["GB"] }),
  L("eu", "Basque", "Latn", { native: "Euskara", regions: ["ES", "FR"] }),
  L("ca", "Catalan", "Latn", { native: "Català", regions: ["ES", "AD", "FR"] }),
  L("gl", "Galician", "Latn", { native: "Galego", regions: ["ES"] }),
  L("mt", "Maltese", "Latn", { native: "Malti", regions: ["MT"] }),
  L("rom", "Romani", "Latn", { regions: ["RO", "HU", "RS"] }),

  // --- Asia — additions --------------------------------------------------------
  L("yue", "Cantonese", "Hant", { native: "粵語", regions: ["HK", "MO", "CN"] }),
  L("bo", "Tibetan", "Tibt", { native: "བོད་སྐད", regions: ["CN", "IN"] }),
  L("sun", "Sundanese", "Latn", { native: "Basa Sunda" }),
  L("ceb", "Cebuano", "Latn", { native: "Binisayâ", regions: ["PH"] }),
  L("ky", "Kyrgyz", "Cyrl", { native: "Кыргыз" }),
  L("tg", "Tajik", "Cyrl", { native: "Тоҷикӣ" }),
  L("tk", "Turkmen", "Latn", { native: "Türkmen" }),
  L("ug", "Uyghur", "Arab", { native: "ئۇيغۇر", dir: "rtl" }),

  // --- Middle East — additions -------------------------------------------------
  L("prs", "Dari", "Arab", { native: "دری", dir: "rtl", regions: ["AF"] }),
  L("kmr", "Kurmanji", "Latn", { regions: ["TR", "SY", "IQ"] }),
  L("ckb", "Sorani", "Arab", { native: "کوردی", dir: "rtl", regions: ["IQ", "IR"] }),
  L("syc", "Syriac (Aramaic)", "Syrc", { dir: "rtl" }),
  L("bal", "Balochi", "Arab", { dir: "rtl", regions: ["PK", "IR", "AF"] }),

  // --- Americas, Caribbean and Oceania — additions ------------------------------
  L("jam", "Jamaican Patois", "Latn", { regions: ["JM"] }),
  L("qu", "Quechua", "Latn", { native: "Runa Simi", regions: ["PE", "BO", "EC"] }),
  L("ay", "Aymara", "Latn", { regions: ["BO", "PE"] }),
  L("gn", "Guarani", "Latn", { native: "Avañeʼẽ", regions: ["PY"] }),
  L("nah", "Nahuatl", "Latn", { regions: ["MX"] }),
  L("nv", "Navajo", "Latn", { regions: ["US"] }),
  L("chr", "Cherokee", "Cher", { dir: "rtl", regions: ["US"] }),
  L("iu", "Inuktitut", "Cans", { regions: ["CA"] }),
  L("mi", "Māori", "Latn", { native: "te reo Māori", regions: ["NZ"] }),
  L("sm", "Samoan", "Latn", { native: "Gagana Samoa", regions: ["WS"] }),
  L("to", "Tongan", "Latn", { native: "lea fakatonga", regions: ["TO"] }),
  L("fj", "Fijian", "Latn", { native: "Na Vosa Vakaviti", regions: ["FJ"] }),
  L("haw", "Hawaiian", "Latn", { native: "ʻŌlelo Hawaiʻi", regions: ["US"] }),
  L("tpi", "Tok Pisin", "Latn", { regions: ["PG"] }),
  L("bi", "Bislama", "Latn", { regions: ["VU"] }),

  // --- Experimental tier: low-resource languages where an LLM can attempt
  // --- translation but quality is NOT established. UI must label these.
  L("dag", "Dagbani", "Latn", { translation: "llm-experimental", regions: ["GH"] }),
  L("ada", "Dangme", "Latn", { translation: "llm-experimental", regions: ["GH"] }),
  L("dga", "Dagaare", "Latn", { translation: "llm-experimental", regions: ["GH"] }),
  L("kac", "Kasem", "Latn", { translation: "llm-experimental", regions: ["GH", "BF"] }),
  L("kus", "Kusaal", "Latn", { translation: "llm-experimental", regions: ["GH", "BF"] }),
  L("gur", "Gurene (Frafra)", "Latn", { translation: "llm-experimental", regions: ["GH"] }),
  L("mpm", "Mampruli", "Latn", { translation: "llm-experimental", regions: ["GH"] }),
  L("gjn", "Gonja", "Latn", { translation: "llm-experimental", regions: ["GH"] }),
  L("nzi", "Nzema", "Latn", { translation: "llm-experimental", regions: ["GH", "CI"] }),
];

/** The STT provider's own language list (kept in sync with the app's claims). */
export const LANGUAGES = LANGUAGE_REGISTRY.filter((l) => l.transcription).map(
  ({ code, name }) => ({ code, name }),
);

/** Everything the translation service will attempt (production + experimental). */
export const TRANSLATION_LANGUAGES = LANGUAGE_REGISTRY.map(
  ({ code, name }) => ({ code, name }),
);

/** Production-tier translation languages only (no experimental entries). */
export const PRODUCTION_TRANSLATION_LANGUAGES = LANGUAGE_REGISTRY.filter(
  (l) => l.translation === "llm",
).map(({ code, name }) => ({ code, name }));

export function findLanguage(code: string): LanguageEntry | undefined {
  return LANGUAGE_REGISTRY.find((l) => l.code === code);
}
