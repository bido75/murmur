# 15 — African Language Quality Tests

**Status:** Plan; requires real hardware, real speakers and the operator's coordination.
**Date:** 2026-10-30

## Milestone: Ghanaian languages (first)

The operator designated Ghanaian languages as the dedicated quality milestone. The registry carries the full priority set (12 languages). This document defines the test protocol — nothing here is claimed as done.

## Prerequisites

- A corrected Android preview APK installed on a real device.
- Native speakers for each language being tested (at minimum: Akan/Twi, Ewe, Ga).
- Consent from speakers for recording and testing.
- The live backend (`notes.giscop.com`) reachable from the device.

## Test protocol per language

### 1. Transcription accuracy
| Test | How | Metric |
|---|---|---|
| Single-speaker, quiet room | Record 30s of continuous speech | WER (word error rate), or human judgment if reference transcript unavailable |
| Single-speaker, code-switched | Same, mixing English and the local language every sentence | WER + count of dropped/switched words |
| Multi-speaker, meeting-style | 2 speakers, 5 min, natural conversation | WER + speaker-label accuracy |
| Technical vocabulary | Use domain terms (budget, contractor, timeline) | Count of correct terms |

### 2. Translation accuracy (notes)
| Test | How | Metric |
|---|---|---|
| Notes generated from transcription | Use the app's normal flow | Native speaker rates: accurate / partially accurate / wrong |
| Key points | Check each key point against the recording | Correct / partially correct / wrong / fabricated |
| Round trip | Translate notes to English and back | Meaning preserved? |

### 3. Rendering
| Test | How |
|---|---|
| Unicode diacritics | Verify ɛ, ɔ, ŋ, tone marks render in the app, in exports and in web |
| Export | Export the transcript and notes; verify characters survive |

### 4. End-to-end
| Test | How |
|---|---|
| Record → transcribe → notes → translate → export | Full workflow on the device, timed |
| Offline | Record offline, sync later, translate when online |
| App restart | Verify the recording, transcript and notes survive |

## Scoring

Per language, per test: record the date, the sample recording ID, the speaker, and the result. Do not average across languages — each language stands on its own evidence.

## What "verified" means

A language is **verified for transcription** when WER is low enough for the notes to be useful (the operator judges this with the native speaker). A language is **verified for translation** when a native speaker confirms the translated notes are accurate and natural.

Neither is claimed until the test has been run with real speakers on a real device.

## Non-Ghanaian African languages

The same protocol applies, prioritized as:
1. Swahili, Yoruba, Hausa (high-resource, most likely to work)
2. Amharic, Somali, Zulu (regional importance)
3. Remaining registry entries

## Provider gap tracking

Languages where the STT or translation provider returns poor/echoed results go into `10-REMAINING-LANGUAGE-GAPS.md` with the provider name and the test evidence. The registry's tier labels are then updated to reflect reality.
