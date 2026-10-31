# 10 — Remaining Language Gaps

**Status:** Honest inventory of what is NOT yet supported, per language and per capability.
**Date:** 2026-10-30

## Translation quality (all languages)

Every translation in production uses the LLM provider. **Per-language quality has not been verified** except English→Twi (live call, 2026-10-30). Until the capability-matrix script runs and human review happens for priority languages, all translations should be treated as "provider attempts, quality unverified". This is not a blocker for shipping the feature (the UI shows results and preserves originals) but it is a quality-assurance gap.

## Transcription gaps (African languages)

The STT provider (Mistral Voxtral; Deepgram nova-3 as alternate) has **not been checked** for African language support. Expected reality: most of the registry's African languages are **not** in commercial STT lists. The registry already reflects this — only the 31 production-tier STT languages carry `transcription: true`.

**Research backlog for African transcription** (per block-20: check alternatives rather than drop):

1. Whisper fine-tunes: community models exist for Swahili, Amharic, Hausa, Yoruba on Hugging Face (licensing: mostly Apache-2.0/MIT — verify per model).
2. Meta MMS (massively multilingual, 1100+ languages, CC-BY-NC — license restriction must be evaluated for commercial use).
3. Google USM / Universal Speech Model — API-only, per-use cost.
4. Local Ghanaian ASR efforts (e.g. research models for Akan) — academic, licensing varies.
5. The local Whisper/Parakeet on-device path (desktop) — could host community African-language models if quality exists.

## UI localization gaps (interface language ≠ content translation)

- The app UI is **English-only**. The registry and i18n architecture are prepared (script/direction metadata exist), but no interface strings are localized yet.
- RTL layout support: registry flags exist; actual layout mirroring (padding/alignment flips) is not implemented.
- Localized dates/numbers: not implemented.

## Picker gaps

- Favorites (starred languages) are not yet implemented — recently-used is (max 4).
- Native-script rendering: native names are stored and displayed; font fallback for Ethiopic/Georgian/Armenian on Android is handled by the OS but was not visually verified on-device.

## Desktop gaps

- The Electron desktop app has no translate flow (translation lives in the mobile/web recording screen). The registry is shared so it can adopt the same picker.

## Registry backlog

- **Sisaala** — ISO-639-3 code verification required.
- **Quechua, Guarani, Nahuatl, Māori, Samoan, Tongan, Fijian** — named in the block-19 coverage targets; not yet in the registry (addition is trivial once codes are confirmed — the block-19 prompt named them as "examples to investigate", not committed entries).
- Additional Ghanaian varieties — enumerated via Glottolog/Ethnologue as described in `12-GHANAIAN-LANGUAGE-COVERAGE.md`.

## Dialect/varieties

- Akan: Asante/Akuapem/Fante share `ak` — variety-specific quality differences are a testing question, not separate registry entries.
- Arabic: DZ/MA/EG/TN varieties are separate registry entries (LLM handles them distinctly); Hassaniya Arabic (`ar-MR`?) is not in the registry (code verification needed).
- Ndebele: `nd` covers both Zimbabwe Ndebele and Northern Ndebele — they are distinct languages in some classifications; registry currently carries one entry.

## Summary

| Gap | Severity | Owner | Tracked in |
|---|---|---|---|
| Per-language translation quality verification | HIGH | developer + native speakers | `08-TRANSLATION-QUALITY-VALIDATION.md` |
| African transcription support | HIGH | developer (provider research) | this file + `14-AFRICAN-LANGUAGE-PROVIDER-MATRIX.md` |
| UI localization (interface strings) | MEDIUM | developer | future i18n pass |
| RTL layout mirroring | MEDIUM | developer | future i18n pass |
| Favorites in picker | LOW | developer | picker evolution |
| Desktop translate flow | LOW | developer | desktop roadmap |
| Backlog language codes | LOW | operator + developer | this file |
