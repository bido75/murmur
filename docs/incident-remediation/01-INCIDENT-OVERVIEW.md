# P1 Remediation — Three Fixes

**Branch:** `feature/murmur-desktop-v2` · **Commit:** `c5b17f1`
**Date:** 2026-10-30

## Three separate root causes — investigated and fixed independently

| # | Issue | Root cause | Fix | Status |
|---|---|---|---|---|
| 1 | Twi export contains English | The `export` Edge Function reads only the original `summaries`/`tasks` tables — it has no knowledge of the `translations` table. The client sends `recording_id` only. | Export function now accepts `lang`, reads the `translations` cache, and overlays translated content onto the exported notes. Client passes `translation?.lang`. | FIXED |
| 2 | Yoruba: `JSON Parse error: Unexpected character: e` | Two stacked issues: (a) the OpenRouter model returns a bare JSON array `["…","…"]` instead of `{"lines":[…]}` — `translateAll` didn't handle that shape; (b) supabase-js `functions.invoke` throws a raw JSON parse error when the Edge Function returns non-JSON (timeout/crash). | (a) `translateAll` now accepts both shapes. (b) `callFn` catches JSON parse errors and returns a user-friendly message. | FIXED |
| 3 | Desktop web: "No microphone was found" | The browser's `getUserMedia({audio: true})` throws `NotFoundError` — no audio input device is visible to the browser. This is an OS/hardware-level issue (Windows privacy settings or no microphone), not a Murmur code issue. | `mic.ts` now probes `enumerateDevices()` before `getUserMedia` and includes OS-specific guidance (Windows Privacy settings path). | IMPROVED (needs device confirmation) |

## Why the desktop microphone issue is NOT a Murmur code bug

The `Permissions-Policy: microphone=(self)` header is correct (verified via tunnel). The `mic.ts` code correctly calls `getUserMedia({audio: true})` on the secure HTTPS page. The `NotFoundError` means the **browser itself** sees no audio input device — this happens when:

1. **Windows privacy settings**: Settings → Privacy → Microphone → "Allow apps to access your microphone" is OFF
2. **No microphone hardware** on the computer
3. **Browser runs in a container/VM** without audio pass-through

The fix adds `enumerateDevices()` probing (detects this case before `getUserMedia`) and includes Windows/Mac privacy settings paths in the error message.

## Test evidence

- `npm test` — exit 0 (all suites: logic, app, DB security)
- `npm run typecheck` — exit 0
- `deno test` (mojibake) — 6/0
- `node --test` (languages) — 8/0
- `node --test` (picker) — 6/0
- Web smoke — 200, `microphone=(self)` header confirmed

## What the operator needs to do

1. **Install the corrected APK** when it finishes building
2. **Test Twi export**: record → notes → translate to Twi → Export → verify the document contains Twi
3. **Test Yoruba translation**: record → notes → translate to Yoruba → verify it doesn't show the JSON parse error
4. **Desktop microphone**: check `chrome://settings/content/microphone` — if no device is listed, check Windows Privacy settings
5. **Add `ANTHROPIC_WORKSPACE_ID`** to `supabase/functions/.env` if the Anthropic key is workspace-scoped (this blocks the direct-Anthropic fallback for the 9 echo-failure languages)

## Remaining gaps (tracked in `10-REMAINING-LANGUAGE-GAPS.md`)

- Amharic translation: provider returns English (echo) — needs alternate provider or model
- Chinese/Russian/Ukrainian/Hebrew/Persian/Pashto/Setswana: same echo issue (transient — retry recovers some)
- African transcription: Twi/Ewe/Ga and most African languages are NOT in the STT provider's language list
- Ghanaian quality milestone: needs real-device testing with native speakers
