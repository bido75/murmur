# 02 — Translation Architecture (audit result)

**Status:** The translation system is **real, not placeholder** — an end-to-end LLM-backed pipeline already exists. The gaps are verification, language metadata, and picker UX, not a missing backend.
**Date:** 2026-10-30

## Verified end-to-end flow

```
User taps Translate (recording screen, language submenu)
  → src/lib/api.ts translateRecording(recordingId, lang, includeTranscript)
      POST {PUBLIC_API_BASE_URL}/functions/v1/translate  (user JWT)
  → supabase/functions/translate/index.ts
      1. requireUser() — RLS-scoped client
      2. lang validated against TRANSLATION_LANGUAGES (90+ entries)
      3. cache lookup in public.translations (recording_id, lang) — cached = no LLM call
      4. notes+tasks flattened to numbered lines, chunked (chunkLines: ≤120 lines / ~12k chars)
      5. translateAll() → llmStructured() per chunk, structured tool schema
         (one output line per input line, same order; wrong count ⇒ original kept)
      6. transcript utterances translated when include_transcript
      7. upsert into public.translations (RLS: read via can_read_recording)
  → UI: translation state replaces display text; quotes/timestamps stay original;
        "Show original language" toggles back
```

## Provider chain (server-side only)

- `llmStructured` (in `_shared/services.ts`) routes by `LLM_PROVIDER` env: `anthropic` (claude-sonnet-5-5 default) | `openrouter` | `ollama` (local).
- Provider keys live only in `supabase/functions/.env` — never in the APK/web bundle (verified: bundle scan clean).
- Structured tool output with a line-count invariant; chunk fall-back keeps originals rather than dropping content.

## Language catalog (as shipped)

- `LANGUAGES` — the transcription engine's list (31 languages).
- `TRANSLATION_LANGUAGES` — translation spread: the 31 + **60 more**, including **40+ African languages**: North (Arabic varieties, Tamazight, Kabyle, Tachelhit), West (Hausa, Yoruba, Igbo, Fula, **Twi/Akan, Ewe, Ga**, Wolof, Bambara, Moore, Fon), Central (Lingala, Kikongo, Sango, Tshiluba, Fang), East (Swahili, Amharic, Oromo, Tigrinya, Somali, Kinyarwanda, Kirundi, Luganda, Kikuyu, Dholuo, Malagasy), Southern (Afrikaans, Zulu, Xhosa, Shona, Sesotho, Setswana, Tsonga, Venda, Swati, Ndebele, Chichewa, Bemba) — plus Asian, European, and Haitian Creole.

## Honest audit findings (the real gaps)

1. **Zero verification data.** `public.translations` has **0 rows** — the path has never been exercised end-to-end on-device. Which of the 90+ languages the LLM translates *well* is untested; the menu presents all as equal.
2. **No capability metadata.** The catalog is `{code, name}` only: no native names, no scripts, no RTL flags, no transcription-vs-translation distinction, no availability/experimental status.
3. **Flat, long picker.** The recording screen's translate submenu lists all 90+ with no search, grouping, or recently-used.
4. **No quality/cost guardrails** at the language level (chunking and count-invariants exist; per-request language validation exists; no per-language rate/cost tracking).
5. **Translation of "AI-generated content"** (follow-up emails, decks) is not yet translated post-generation — the recording screen's translate covers summary/tasks/transcript only.
6. **Encoding** — the mojibake defect (fixed, see `01-UNICODE-ROOT-CAUSE.md`) would have corrupted any stored translation; the new repo-wide guard test protects the pipeline.

## Build-on plan (maps to prompt phases 3–8)

| Phase | Deliverable | Base to build on |
|---|---|---|
| 3 | Shared language registry with BCP 47 + native names + script + direction + capability flags | extend `TRANSLATION_LANGUAGES` into `src/lib/languages.ts` (shared by app + functions) |
| 4 | Provider-independent service with routing/observability | `llmStructured` already abstracts providers; add per-language capability gates + provider tagging in stored rows |
| 5 | Full transcript/notes/email/deck translation, stored separately | `translations` table pattern; extend to `recap_emails`/decks |
| 6 | Searchable picker (native names, scripts, RTL, recent, favorites) | registry + a picker component |
| 7 | i18n readiness | registry + device locale detection; keep English default |
| 8 | Capability matrix with samples + last-verified dates | script calling `translate` for one sample per language; store results |

## Next concrete steps

1. Exercise the live path once (any recording → Twi + Yoruba + Arabic) to confirm the stored-row shape and LLM provider behavior (also proves African languages end-to-end).
2. Build the shared registry (`src/lib/languages.ts`) superseding the two lists, with the capability fields; regenerate `TRANSLATION_LANGUAGES` from it so app and functions never drift.
3. Searchable picker component on the recording screen.
4. Capability-matrix script + `docs/multilingual/03-LANGUAGE-COVERAGE-MATRIX.md` with honest `unverified` status per language.
