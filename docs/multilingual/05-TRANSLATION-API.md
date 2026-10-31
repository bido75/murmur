# 05 — Translation API

**Status:** Implemented and verified (the `translate` Edge Function is unchanged from the audit; registry + picker added on the client side).
**Date:** 2026-10-30

## Endpoint

`POST {SUPABASE_URL}/functions/v1/translate`

## Request

```json
{
  "recording_id": "uuid",
  "lang": "ak",              // BCP-47/ISO-639 code, validated against the registry
  "include_transcript": true  // optional; also translates the transcript
}
```

Auth: Supabase JWT (the user's session token), passed as `Authorization: Bearer …` and `apikey`. RLS scopes all reads to recordings the user can access.

## Response

```json
{
  "recording_id": "uuid",
  "lang": "ak",
  "summary": {
    "overview": "…",
    "key_points": ["…", "…"],
    "decisions": [{"text": "…"}],
    "open_questions": ["…"]
  },
  "tasks": {"task-uuid": "translated task text", "…": "…"},
  "utterances": [{"start_ms": 0, "end_ms": 1000, "speaker": 0, "text": "…"}]
}
```

`utterances` is present only when `include_transcript: true` and a transcript exists.

## Error responses

| Status | Meaning |
|---|---|
| 400 | Language not in the registry |
| 401 | Not signed in |
| 404 | Recording not found |
| 500 | LLM/provider failure (logged server-side) |

## Caching

Results are stored in `public.translations` keyed by `(recording_id, lang)`. A cached hit is returned without an LLM call unless `include_transcript` is requested and the cached row lacks `utterances`. The table is RLS-scoped: read requires `can_read_recording(recording_id)`; write is service-role only.

## Untranslated-echo guard

If the LLM returns every line byte-identical to the input (e.g. the Amharic gap), `translateAll` logs a server-side error. The stored row is still written (the content is valid — it just isn't translated), but the capability matrix records the language as failed and the UI's registry tier labels it accordingly. A future schema change can add an `echo: true` flag to the stored row for the UI to surface.

## Client-side picker

The recording screen's `Translate…` action opens `LanguagePickerSheet`:
- Search input (diacritic-folded: English name, native name, code).
- "Recently used" section (max 4, persisted in AsyncStorage).
- Alphabetical full list with native names and codes.
- Experimental languages labeled "(experimental)".
- Selection calls `translateRecording(recordingId, code, true)` — same API as before, now with an honest picker in front.
