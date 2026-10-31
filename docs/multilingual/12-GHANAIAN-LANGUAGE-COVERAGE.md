# 12 — Ghanaian Language Coverage

**Status:** Priority set implemented in the registry; per-language quality verification pending.
**Date:** 2026-10-30

Ghanaian languages are the designated first milestone for African coverage (per the operator's mandate). The registry carries every language from the priority list that has a verified ISO-639-3 code.

## Priority coverage table

| Language | Code | Native name | Script | Registry tier | Verified? |
|---|---|---|---|---|---|
| Akan (Asante/Akuapem Twi, Fante) | ak | Akan | Latn | production | **Translation live-verified 2026-10-30** (provider call, tone vowels correct) |
| Ewe | ee | Eʋegbe | Latn | production | same provider path, quality unverified |
| Ga | gaa | Gã | Latn | production | same provider path, quality unverified |
| Dagbani | dag | | Latn | experimental | LLM will attempt; quality unestablished |
| Dangme | ada | | Latn | experimental | unestablished |
| Dagaare | dga | | Latn | experimental | unestablished |
| Kasem | kac | | Latn | experimental | unestablished |
| Kusaal | kus | | Latn | experimental | unestablished |
| Gurene (Frafra) | gur | | Latn | experimental | unestablished |
| Mampruli | mpm | | Latn | experimental | unestablished |
| Gonja | gjn | | Latn | experimental | unestablished |
| Nzema | nzi | | Latn | experimental | unestablished |

**Honest note on varieties:** Akan covers Asante Twi, Akuapem Twi and Fante under `ak` at the request level (the STT engine and LLM treat Akan as one language; variety-specific behavior is a quality question, not a separate registry entry). Separate codes exist (fat = Fante, tw-Asante) and can be split out if provider support justifies it.

## Backlog (code verification required before registry entry)

| Language | Reason not yet in registry |
|---|---|
| Sisaala | ISO-639-3 code requires verification (Tumul `sda` vs Palaba variants are distinct entries) |
| Further Ghanaian varieties | To be enumerated from verified linguistic sources (Ethnologue/Glottolog) with codes confirmed |

## Testing milestone (planned, per the operator's directive)

Ghanaian languages are the dedicated testing milestone:

1. **Dataset:** record sample audio (with consent) in Akan/Twi, Ewe, Ga — ordinary speech, site-walk vocabulary, meeting-style content; plus code-switching with Ghanaian English.
2. **Transcription check:** run the STT provider (Mistral Voxtral) on each sample; record accuracy honestly (WER where computable). If the provider does not support a language, the registry shows transcription unavailable — no workaround claim.
3. **Translation check:** run the `translate` function on the generated notes into each Ghanaian language; native-speaker review where practical (the operator is best positioned to arrange reviewers for Twi/Ewe/Ga).
4. **Rendering check:** Unicode diacritics (ɛ, ɔ, ɖ, ŋ, tone marks) render in the app, exports and web.
5. **Code-switching:** mixed Ghanaian-English recordings transcribe without dropping either language's words (tracked in `13-AFRICAN-DIALECTS-AND-CODE-SWITCHING.md`).

Results land in `15-AFRICAN-LANGUAGE-QUALITY-TESTS.md` with dates and samples. Nothing is claimed production-ready before this milestone completes for a given language.
