# 06 — Mobile and Web Integration (translate path)

**Status:** Searchable picker shipped; translate function untouched; registry shared.
**Date:** 2026-10-30 · Commit `f816929`

## What changed

| Layer | Change |
|---|---|
| `supabase/functions/_shared/languages.ts` | **New** — the single language registry: 101 entries with BCP-47 code, English name, native name (where verified), ISO-15924 script, direction (RTL for Arabic/Hebrew-script languages), regions, translation tier (`llm` production / `llm-experimental`), transcription flag. Derived exports: `LANGUAGES` (STT list, 31), `TRANSLATION_LANGUAGES` (all 101), `PRODUCTION_TRANSLATION_LANGUAGES` (92), `findLanguage(code)`. |
| `supabase/functions/_shared/translate.ts` | Now re-exports the registry; the flat arrays were removed (single source of truth — app and functions never drift). `translateSystem`, `chunkLines`, `TRANSLATE_TOOL` unchanged. |
| `src/lib/shared.ts` | Also re-exports `LANGUAGE_REGISTRY` and `findLanguage` for app code. |
| `src/lib/languagePicker.ts` | **New** — pure picker logic: diacritic-folded search (English name, native name, code), recent-languages (newest-first, max 4), alphabetical all-languages section. Tested (6 tests). |
| `src/components/LanguagePickerSheet.tsx` | **New** — searchable modal: search input, "Recently used" section, alphabetical list with native names and codes, "(experimental)" labels on the low-resource tier, Cancel. Works on web and Android (same RN primitives). |
| `src/app/recording/[id].tsx` | The `Translate…` menu action now opens the picker instead of the flat 100-item submenu. Selection flows into the existing `translateRecording()` call — the backend path is unchanged. |

## What did NOT change

- The `translate` Edge Function, its chunking, cache table, provider chain — untouched.
- The transcription language list and its settings UI — untouched.
- The Electron desktop — untouched (it has no translate flow of its own yet).
- Recording, sync, notes generation — untouched.

## Registry → UI honesty guarantees (tested)

- Experimental languages (Dagbani, Dangme, Dagaare, Kasem, Kusaal, Gurene, Mampruli, Gonja, Nzema) are labeled "(experimental)" everywhere they appear — they are never presented as production-ready.
- Experimental languages are never in the STT list — transcription claims come only from the provider's list.
- RTL scripts (Arabic, Darija, Egyptian Arabic, Hebrew, Persian, Urdu, Pashto, Kurdish) are flagged `dir: "rtl"` for the picker and any future rendered translation.
- A repo-wide mojibake guard test prevents encoding corruption from re-entering any source file.

## Verification

- `npm test` — all suites green (exit 0).
- `node --test src/lib/languagePicker.test.ts` — 6/6.
- `node --test src/lib/languages.test.ts` — 8/8.
- `node --test src/lib/mojibake.test.ts` — 6/6.
- `npm run typecheck` — clean.
