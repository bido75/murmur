# 09 — Security, Privacy and Cost

**Status:** Controls in place; documented here for the multilingual system specifically.
**Date:** 2026-10-30

## Security

| Control | Evidence |
|---|---|
| Provider credentials server-side only | All API keys (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `MISTRAL_API_KEY`) live in `supabase/functions/.env` (gitignored). Bundle scans (APK binary + dist-web) confirm no keys in client artifacts. |
| Translation requests authenticated | The `translate` function requires a valid Supabase JWT (`requireUser()`); all reads RLS-scoped via `can_read_recording()`. |
| Translation writes service-role only | `public.translations` revokes insert/update/delete from anon+authenticated; only `adminClient()` writes. |
| No cross-account leakage | `client.from('recordings')` is RLS-scoped — the function only reads recordings the caller can access; `translations` read policy checks `can_read_recording(recording_id)`. |
| No unrestricted execution | The LLM call is server-side only; the renderer cannot reach OpenRouter/Anthropic directly (CSP `connect-src` allows only the Supabase origin and named AI endpoints). |
| Input validation | `lang` is validated against the registry (400 if not found); `recording_id` is a UUID checked against the recordings table. |

## Privacy

| Concern | Position |
|---|---|
| What leaves the device for translation | Note/task/transcript text — sent to the LLM provider via the server. Audio does not leave the device for translation (it may leave for transcription if cloud STT is chosen). |
| Local Only mode | When Local Only is on, transcription runs on-device and **no translation is offered** (the feature requires the server LLM). The registry's `localOnly` setting gates the cloud path. |
| Provider data-retention | Anthropic/OpenRouter retention policies apply to the prompt content. The system prompt instructs the model to keep [PII] tags unchanged — the transcript redaction feature (`redact` in TranscriptionOptions) removes personal names/numbers before translation. |
| Cached translations | Stored in `public.translations` with RLS — visible only to users who can read the recording. |

## Cost

| Item | Control |
|---|---|
| Per-request size | `chunkLines` bounds each LLM call to ≤120 lines / ~12k chars. |
| Caching | `public.translations` — a cached hit skips the LLM entirely. |
| Line-count invariant | Wrong-count chunks keep originals (no wasted regeneration). |
| Untranslated echo | Logged server-side; the capability matrix records provider gaps so users don't waste calls on languages the provider can't handle. |
| Cost tracking | Per-language/per-request cost accounting is on the roadmap (the capability script records the provider and model per language; the function does not yet track tokens used per request — noted as a gap). |

## Model selection risk

The default model (`claude-sonnet-4.5`) is used for **all** translation tiers. When a better/cheaper model becomes available for specific languages, the registry's tier system allows per-language provider routing (a language could route to a different provider/model). This is not yet implemented — the routing is all-or-nothing via `LLM_PROVIDER`. Tracked as a gap in `10-REMAINING-LANGUAGE-GAPS.md`.
