# 04 — Provider Capabilities

**Status:** Providers audited; capabilities documented per language in `language-capabilities.json`.
**Date:** 2026-10-30

## Configured providers

| Capability | Provider | Model | Config source | Keys |
|---|---|---|---|---|
| Transcription (STT) | Mistral | `voxtral-mini-transcribe-3` | `STT_PROVIDER=mistral`, `MISTRAL_STT_MODEL` | `MISTRAL_API_KEY` (server-side) |
| Transcription (alternate) | Deepgram | `nova-3` | `DEEPGRAM_API_KEY` | server-side |
| Translation (LLM) | OpenRouter | `anthropic/claude-sonnet-4.5` | `LLM_PROVIDER=openrouter`, `OPENROUTER_MODEL` | `OPENROUTER_API_KEY` (server-side) |
| Translation (alternate) | Anthropic direct | `claude-sonnet-5-5` | `LLM_PROVIDER=anthropic` | `ANTHROPIC_API_KEY` (server-side) |
| Translation (local) | Ollama | configurable | `LLM_PROVIDER=ollama` | none needed |

All credentials live in `supabase/functions/.env` (gitignored). No key ships in the APK, web bundle, or desktop build (bundle scans confirm — see `08-SECURITY-PRIVACY-AND-COST.md`).

## African language capability results (verified 2026-10-30)

Results in `language-capabilities.json`. Summary:

| Language | Translation | Evidence |
|---|---|---|
| Twi (Akan) | **verified** | live provider call, correct tone vowels |
| Swahili | **verified** | live provider call, correct time convention |
| Yoruba | **verified** | live provider call, full diacritics |
| Hausa | **verified** | live provider call, hooked letters |
| Arabic | **verified** | live provider call, RTL |
| Amharic | **FAILED** | untranslated echo — provider gap |
| Zulu, Xhosa, Shona, etc. | **unverified** | same mechanism, quality unknown |
| Dagbani, Dangme, etc. (experimental) | **not attempted** | tiered experimental; quality unestablished |

## What "verified" means here

"Verified" = the provider returned non-identical text in the target language with the correct line count. It does **not** verify translation accuracy — that requires native-speaker review (`15-AFRICAN-LANGUAGE-QUALITY-TESTS.md`).

## Remaining provider checks

- **STT per-language support**: obtain the Mistral Voxtral and Deepgram nova-3 supported-language lists; cross-check against the registry's African entries. Until then, transcription capability is claimed only for the 31-entry `LANGUAGES` list.
- **Alternate providers for Amharic**: Anthropic direct (without OpenRouter), dedicated Amharic MT, or open-source models — tracked in `10-REMAINING-LANGUAGE-GAPS.md`.
- **Full-matrix run**: `node scripts/language-capability.mjs --all` (~92 small calls).
