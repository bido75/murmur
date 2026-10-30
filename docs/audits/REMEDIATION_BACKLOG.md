# Remediation backlog

Prioritized, file-specific. Each item is actionable without external approvals
unless marked EXTERNAL.

| ID | Priority | Finding | File | Required fix | Acceptance criteria | Complexity |
|---|---|---|---|---|---|---|
| 1 | P0 | Interrupted-recording recovery untested | `src/lib/recorder.ts` (`recoverInterruptedRecording`) | Unit test: seed AsyncStorage `recorder.active.v1` with a real local file + row fixture; call recovery; assert the enqueue + `saveActive(null)` and the recording id returned. | Test fails if recovery is removed; suite green. | Low |
| 2 | P0 | Branch not pushed | repo | Push `feature/transcription-local` and `feature/murmur-app-remediation`; open PR into `main`. | Both branches visible on origin. | Low |
| 3 | P0 | Credentials exposed in chat | `supabase/functions/.env` (local only) | Rotate Google, Slack, Procore, HubSpot, Deepgram, OpenRouter, Mistral, Anthropic; store in a secret manager; update the local env with fresh values. | Old values rejected by providers. | Low |
| 4 | P1 | Live OAuth round-trips unverified | `calendar/index.ts`, `connect/index.ts`, `procore/index.ts` | EXTERNAL: run `cloudflared` (or a domain) → set `PUBLIC_API_BASE_URL` → register `{origin}/functions/v1/{calendar,connect,procore}/callback` in each console → connect once per provider. | Each provider shows "connected as <email>" in Settings. | Medium |
| 5 | P1 | Settings save/rollback untested | `src/app/(tabs)/settings.tsx` | Component/E2E test: toggle Field Mode → expect "Saved." after a successful save; simulate a rejected `saveSettings` → expect rollback + "Couldn't save". | Test fails if rollback removed. | Medium |
| 6 | P2 | Webhook delivery has no retry/backoff | `supabase/functions/_shared/after_ready.ts` | Add a `webhook_deliveries` table (webhook_id, event, body, status, attempts, next_attempt_at); deliver via a scheduled job with exponential backoff; cap attempts. | A failing endpoint is retried and visible in history. | Medium |
| 7 | P2 | Search filters missing | `src/app/(tabs)/search.tsx` | Add filter chips (date range, project, type) feeding the existing RPC params. | Filters narrow results; tests updated. | Medium |
| 8 | P2 | Telephony provider decision | `supabase/functions/ringcentral/`, `aircall/` | Either supply RingCentral credentials, or scope an Aircall-native import path (the Aircall webhook import already exists). | Phone page shows a working connect or an explicit not-configured state. | High |
| 9 | P2 | OAuth-client registry decision | `supabase/functions/_shared/trackers.ts` | Decide: keep user-pasted tokens (documented) or add a server-side OAuth-client registry for Notion/Atlassian/Asana/Linear/monday/ClickUp/Trello. | Decision documented in `INTEGRATION_STATUS.md`. | High |
| 10 | P3 | Performance baseline absent | `src/app/(tabs)/recordings`, `search.tsx` | Seed 500 recordings + one 3-hour transcript; measure list render, search latency, and add pagination if needed. | Documented numbers in `TEST_RESULTS.md`. | Medium |
| 11 | P3 | Trailing whitespace | `scripts/test-transcription.mjs` (lines 24, 27) | Trim. | `git diff --check` clean. | Low |
| 12 | P3 | Working-tree reformat noise | 60 files | Commit the quote-style normalization as its own commit, or discard. | Clean `git status`. | Low |
| 13 | P3 | Physical-device + screen-reader verification | manual | Record on a real Android/iOS device including background + crash-recover; run VoiceOver/TalkBack over Settings. | Documented results in `TEST_RESULTS.md` / `ACCESSIBILITY_REVIEW.md`. | Medium (EXTERNAL: hardware) |
| 14 | P3 | macOS/Linux desktop paths | `desktop/src/**` | Run the desktop build + dictation paste path on macOS and Linux. | Results documented. | Medium (EXTERNAL: hardware) |

Dependencies: items 4 and 3 are prerequisites for proving items in Phases 6/7.
Items 1, 2, 3 are this week's work; 4–7 next sprint; 8–14 as capacity allows.

Suggested order: 2 → 3 → 1 → 5 → 4 → 7 → 6 → 10 → 8 → 9 → 13 → 14 → 11 → 12.