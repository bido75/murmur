# 13 — African Dialects and Code-Switching

**Status:** Architectural notes and honest limitations; testing planned.
**Date:** 2026-10-30

## Dialects and varieties in the registry

The registry carries languages at the ISO-639 level. Where varieties are mutually intelligible and share a code (e.g. Akan covers Asante/Akuapem/Fante), one entry serves all. Where varieties are distinct enough for separate codes, separate entries are used (e.g. `ar-DZ`/`ar-MA`/`ar-EG`/`ar-TN` for Arabic varieties, `gur` for Gurene/Frafra).

The registry currently does **not** model sub-varieties (e.g. Asante vs Akuapem Twi as separate entries). This is correct for translation (the LLM produces Akan, not a specific variety) but may matter for transcription (STT engines may perform differently per variety).

## Code-switching

**The reality:** recordings in Ghana, Nigeria, Kenya and most of Africa routinely mix English with local languages mid-sentence. This is normal speech, not an error.

**Current behavior (from code, not claims):**
- The STT provider (Mistral Voxtral / Deepgram nova-3) handles code-switching to the extent the provider does — this is a provider capability, not an app control.
- The transcription language parameter (`lang`) can be set to `null` for automatic detection — but per-language auto-detection accuracy is provider-dependent and unverified for African languages.
- The `mixed-language transcription` capability exists in the TranscriptionOptions interface (`multichannel`, `keyterms`, `redact`) but the underlying provider's handling of mixed African languages is **unverified**.
- The translate function receives the transcript as-is; it translates each line into the target language, so a code-switched line ("The budget is ɛ20,000") is translated as a whole — the model preserves numbers and names per the system prompt.

**Honest limitation:** no African code-switching accuracy has been measured. This requires real recordings with real speakers (the quality milestone in `15-AFRICAN-LANGUAGE-QUALITY-TESTS.md`).

## What the product can do today

- A user records in Akan/Twi (with English code-switching) → the STT provider transcribes what it hears (accuracy = provider's, unverified) → the LLM generates notes from the transcript (quality = LLM's, unverified for Akan) → the user can translate the notes into another language.
- If the STT provider cannot transcribe Twi speech, the user gets no transcript and no notes. The recording still uploads and stores, but the "Generate notes" step will produce nothing meaningful. This is the **transcription gap**, not a translation gap.

## Recommendations for the quality milestone

1. Record 3 speakers: one in pure Akan, one in Ghanaian English, one code-switching every sentence.
2. Run through the STT provider → record WER per speaker type.
3. Generate notes from each transcript → check key-point extraction quality in the mixed case.
4. Translate the notes to French → check whether code-switched content survives the round trip.

Results go in `15-AFRICAN-LANGUAGE-QUALITY-TESTS.md`.
