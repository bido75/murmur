# 10 — Remaining Language Gaps

**Status:** Honest inventory, updated after the full capability-matrix run.
**Date:** 2026-10-30
**Dashboard:** `capability-dashboard.json`

## Capability dashboard

| Category | Count |
|---|---|
| **Cataloged languages** | **171** |
| Translation: verified | **153** (provider produced non-identical text in the target language) |
| Translation: failed (echo) | **9** (Amharic, Chinese ×2, Japanese, Russian, Ukrainian, Persian, Pashto, Setswana) |
| Translation: experimental (not attempted by the matrix) | **9** (Ghanaian low-resource) |
| **Transcription-ready** | **31** (STT provider list; per-language verification pending) |
| Translation pending | **0** (all 162 production-tier tested) |

English→English echo is expected (target = source) and is not a gap. The 9 non-English echo failures are provider routing limitations — the LLM sometimes returns the input instead of translating. The retry mechanism recovers some transiently but these 9 persist consistently.

## What the echo failures mean for users

When the translate function hits an echo failure:
1. The user taps Translate → selects the language.
2. The function calls the LLM.
3. The LLM returns the same text.
4. The echo guard logs it server-side.
5. The result is stored in `translations` — but it's the same text as the original, not a translation.
6. The UI shows the text wrapped in "Showing in {language}. Quotes stay in the original words." — the user sees the original content unchanged.

**This is honest but unhelpful.** The right fix is one of:
- Retry with a different model (`CLAUDE_MODEL` direct Anthropic, or a different OpenRouter model) — the capability script's retry recovered 8 of 17, suggesting model routing varies.
- Surface a UI error: "Translation to {language} is not currently available. Please try again later." — requires the function to detect the echo and return a 502.
- Show the registry's capability status in the picker before the user selects.

## Transcription gaps

All 31 STT-list languages claim `transcription: true`. Per-language verification against the STT provider's documentation has NOT been run. The STT provider is Mistral Voxtral (`voxtral-mini-transcribe-3`); Deepgram (`nova-3`) is the alternate.

**African languages in the STT list:** Arabic (the only one with a verified STT claim). Hausa, Swahili, Yoruba are **not** in the 31-entry list — they cannot be transcribed until the STT provider adds them or an alternate STT engine is used.

**African languages NOT in the STT list** (transcription unavailable): Twi, Ewe, Ga, Igbo, Fula, Wolof, Bambara, Moore, Fon, Lingala, Kikongo, Sango, Tshiluba, Fang, Amharic, Oromo, Tigrinya, Somali, Kinyarwanda, Kirundi, Luganda, Kikuyu, Dholuo, Malagasy, Zulu, Xhosa, Shona, Sesotho, Setswana, Tsonga, Venda, Swati, Ndebele, Chichewa, Bemba, Afrikaans, Mandinka, Kanuri, Krio, Mende, Maasai, Kituba, Ewondo, Duala, Mongo — and all experimental-tier languages.

This is the **biggest product gap** for African-language users: they can translate text, but they cannot transcribe speech in their language.

## UI localization gaps

- The app UI is **English-only**. The registry has native names and scripts, but no interface strings are localized.
- RTL layout mirroring (Arabic/Hebrew/Urdu/Persian/Pashto/Kurdish): flagged in the registry but not implemented in the layout engine.
- Localized dates/numbers: not implemented.

## Picker gaps

- Favorites (starred languages): not yet implemented (recently-used is, max 4).
- Region filter: not yet implemented (search and alphabetical browsing work).
- Virtualization: the picker uses a ScrollView with all 171 entries; a FlatList with virtualization would be needed for very large catalogs (not urgent at 171).

## Desktop translate flow

The Electron desktop app has no translate UI. The registry is shared, so it can adopt the same picker, but the desktop recording screen doesn't have a translate action yet.

## Provider model routing

The 9 echo failures likely stem from the OpenRouter provider routing to a model that doesn't handle the tool-call format well for those language/script combinations. Possible fixes:
1. Use Anthropic direct (`LLM_PROVIDER=anthropic`) instead of OpenRouter for affected languages.
2. Use a different OpenRouter model for the affected language pairs.
3. Add per-language model overrides in the registry.
4. Remove the tool-call wrapper and use plain text output with line-splitting.

All are tracked as product decisions for the operator.
