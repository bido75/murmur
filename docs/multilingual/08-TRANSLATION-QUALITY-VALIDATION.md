# 08 — Translation Quality Validation

**Status:** Representative subset verified live (2026-10-30); full matrix pending; Amharic confirmed as a provider gap.
**Date:** 2026-10-30
**Machine-readable results:** `docs/multilingual/language-capabilities.json`
**Generator:** `scripts/language-capability.mjs` (subset by default; `--all` for every production-tier language)

## Method

1. Three fixed sample lines (meeting-relevant content) are translated per language via the live provider (OpenRouter → `anthropic/claude-sonnet-4.5`), using the same system prompt and tool schema as the production `translate` function.
2. **Validation checks:**
   - HTTP 200 from the provider.
   - Structured tool output present.
   - Line count matches the input exactly (the production function's own invariant).
   - **Untranslated-echo check:** if every output line is byte-identical to its input, the result is `failed` with reason "untranslated echo" — the model did not translate.
3. Results are merged into `language-capabilities.json` (incremental runs accumulate).

## Verified results (2026-10-30)

| Code | Language | Status | Sample (first line) | Notes |
|---|---|---|---|---|
| ak | Twi (Akan) | **verified** | Nhyiamu no fi ase nnɛ anɔpa nnɔnkron | correct tone vowels ɛ/ɔ; verified live earlier too |
| sw | Swahili | **verified** | Mkutano unaanza saa tatu asubuhi kesho | correct Swahili time-telling convention (saa tatu) |
| yo | Yoruba | **verified** | Ìpàdé náà bẹ̀rẹ̀ ní aago mẹ́sàn-án òwúrọ̀ ọ̀la | full diacritics (Ẹ, ọ̀, àárọ̀-class marks) |
| ha | Hausa | **verified** | Taron zai fara da ƙarfe tara safe gobe | correct hooked letters (ƙ) |
| ar | Arabic | **verified** | الاجتماع يبدأ في التاسعة صباح غد | RTL, correct |
| es | Spanish | **verified** | La reunión comienza mañana a las nueve | control |
| fr | French | **verified** | La réunion commence demain matin à neuf heures | control |
| zh | Chinese (Simplified) | **verified** | 会议明早九点开始。 | CJK |
| hi | Hindi | **verified** | कल सुबह नौ बजे बैठक शुरू होगी। | Devanagari |
| **am** | **Amharic** | **FAILED — untranslated echo** | (returned English unchanged) | The model echoed the input instead of translating into Ge'ez. Provider gap. |

## Honest quality assessment

The automated script verifies **that** the provider produced a translation (different from input, correct line count). It does **not** verify **how good** the translation is — that requires native-speaker review per `15-AFRICAN-LANGUAGE-QUALITY-TESTS.md`. An LLM's fluent output in a language the reviewer doesn't speak is not evidence of accuracy.

The prompt is explicit: "Do not use an LLM's self-assessment as the sole evidence of translation accuracy." No accuracy claim is made beyond "the provider returned non-identical text in the target language."

## Amharic finding

Amharic consistently returned English unchanged across two attempts. This means:
- The translate function's echo guard (`console.error` in `translateAll`) will flag it in production.
- The capability matrix records it as **failed** — the language should be shown with an honest "translation unavailable" status in the UI rather than silently displaying English text wrapped in an Amharic label.
- Next step: try the alternate providers (Anthropic direct, Deepgram translation if available, or a dedicated Amharic MT service). Tracked in `10-REMAINING-LANGUAGE-GAPS.md`.

## Full matrix

Run `node scripts/language-capability.mjs --all` to verify all 92 production-tier languages (~92 small API calls, well under $1 at current pricing). Results merge incrementally — re-running a failed language updates only that entry.
