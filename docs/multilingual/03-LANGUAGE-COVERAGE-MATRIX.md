# 03 — Language Coverage Matrix

**Status:** Registry shipped (`supabase/functions/_shared/languages.ts`, 101 entries); per-language quality verification pending (script + live runs scheduled).
**Date:** 2026-10-30

## Capability tiers (honest definitions)

| Tier | Meaning | Count |
|---|---|---|
| **Transcription + translation** | In the configured STT provider's language list AND translatable via the LLM provider | 31 |
| **Translation (production tier)** | LLM translation available; per-language quality not yet human-verified | 61 |
| **Translation (experimental)** | Low-resource languages where the LLM will attempt translation but quality is **not established** — UI labels these "(experimental)" | 9 |
| **Backlog (not in registry)** | No verified ISO-639 code or no reliable provider path yet — listed in `12-GHANAIAN-LANGUAGE-COVERAGE.md` | Sisaala (+ others as identified) |

**No language is marked production-ready without evidence.** The only live-verified translation as of 2026-10-30 is **English → Twi (Akan)** (provider call recorded; correct tone vowels ɛ/ɔ).

## Coverage snapshot by region

| Region | Languages in registry | Notes |
|---|---|---|
| West Africa | Hausa, Yoruba, Igbo, Fula, Twi/Akan, Ewe, Ga, Wolof, Bambara, Moore, Fon **+ experimental: Dagbani, Dangme, Dagaare, Kasem, Kusaal, Gurene, Mampruli, Gonja, Nzema** | Ghanaian set complete per block-20 priority list |
| East Africa | Swahili, Amharic, Oromo, Tigrinya, Somali, Kinyarwanda, Kirundi, Luganda, Kikuyu, Dholuo, Malagasy | Amharic/Tigrinya in Ethiopic script |
| Central Africa | Lingala, Kikongo, Sango, Tshiluba, Fang | |
| Southern Africa | Afrikaans, Zulu, Xhosa, Shona, Sesotho, Setswana, Tsonga, Venda, Swati, Ndebele, Chichewa, Bemba | |
| North Africa | Arabic (+ DZ/MA/EG/TN varieties), Tamazight, Kabyle, Tachelhit | RTL + Tifinagh script noted |
| Asia / Middle East | Arabic, Hebrew, Persian, Urdu, Punjabi, Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Nepali, Sinhala, Burmese, Khmer, Lao, Turkish, Kurdish, Malay, Javanese, Indonesian, Vietnamese, Thai, Tagalog, Chinese (S+T), Japanese, Korean, Mongolian, Kazakh, Uzbek, Pashto | RTL flags on Arab/Hebrew script entries |
| Europe | English, French, Spanish, Portuguese, German, Italian, Dutch, Polish, Czech, Slovak, Slovenian, Croatian, Bosnian, Serbian, Bulgarian, Macedonian, Albanian, Greek, Romanian, Hungarian, Swedish, Danish, Norwegian, Finnish, Estonian, Latvian, Lithuanian, Icelandic, Russian, Ukrainian | |
| Americas / Oceania | Haitian Creole | (Quechua, Guarani, Nahuatl, Māori, Samoan, Tongan, Fijian: backlog — see `10-REMAINING-LANGUAGE-GAPS.md`) |

## Capability columns (per language, maintained in the registry)

- `translation`: `"llm"` (production tier) or `"llm-experimental"`
- `transcription`: boolean — STT provider list membership only
- `native`, `script`, `dir`, `regions`: for rendering, search, and RTL layout

## Verification status

| Claim | Evidence |
|---|---|
| Provider translates English → Twi | Live OpenRouter call 2026-10-30 (recorded in session log; correct ɛ/ɔ tone vowels) |
| Same provider handles the other 100 languages | **UNVERIFIED** — same mechanism, quality unknown per language |
| Transcription per language | **UNVERIFIED** — STT provider is Mistral Voxtral (`MISTRAL_STT_MODEL=voxtral-mini-transcribe-3`); its supported-language list must be obtained from the provider's documentation and cross-checked before any transcription claim is shown in the UI |

## Next

- Capability-matrix script (`scripts/language-capability.mjs`): one sample translation per language, stores result + date in `docs/multilingual/language-capabilities.json` (cost-bounded: ~100 small LLM calls, run on demand).
- Human review of priority languages (Ghanaian set first) per `15-AFRICAN-LANGUAGE-QUALITY-TESTS.md`.
