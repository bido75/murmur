# Frontend / UX audit (evidence-based)

Re-tested the eleven specific audit findings; each verified in source, several
also by real execution this engagement.

| # | Original finding | Before | After (verified) |
|---|---|---|---|
| 1 | Add dialog doesn't close | Reported | `src/lib/dialog.tsx` is the shared modal surface; not reproduced in source. Needs a real keyboard run. **PARTIAL** |
| 2 | Project actions menu doesn't close | Reported | Same shared surface. **PARTIAL** |
| 3 | Radio selection unreliable | Reported | Root cause confirmed and **FIXED**: `accessibilityState.selected` → `checked` in 6 files; state now readable. |
| 4 | Recording-detail tabs don't switch | Reported | `Segmented` uses `accessibilityRole="tab"` + `selected` — correct semantics; tabs verified switching in the browser audit. **PASS** |
| 5 | Hidden accessibility elements | Reported | Source review: legitimate conditional visibility (fields shown only in relevant state). **PASS** |
| 6 | No recording-start feedback | Reported | Indicator + timer + level meter + elapsed time exist in `recorder.ts`; verified on device. **PASS** |
| 7 | Field Mode doesn't restore default | Reported | **FIXED**: the switch no longer writes `default_template`; effective type computed at record time. |
| 8 | Settings persistence unverified | Reported | **FIXED + TESTED**: account prefs now in `user_settings` with a passing DB isolation test. |
| 9 | /webhooks 404 | Reported | **FALSE POSITIVE**: "Webhooks & REST API" routes to `/developers`, which exists. |
| 10 | Hardcoded MCP endpoint | Reported | **FALSE POSITIVE**: derived from `APP_URL`/`SUPABASE_URL` in `@/lib/config`; the LAN value came from local `.env.local`. |
| 11 | Static uploads indicator | Reported | **FALSE POSITIVE**: live pending count + `Retry now` already wired to `pendingOps()`. |

## Route inventory

All routes referenced by Settings/buttons exist in `src/app/`: alerts, api-access,
automations, brief, deck, developers, devices, followup, import-link,
integrations, join, notetaker, phone, privacy, record, share, sign-in,
sso-callback, templates, upcoming, plus `(tabs)` screens and dynamic
`recording/[id]`, `project/[id]`, `team/[id]`, `reels/[id]`, `s/[token]`,
`h/[token]`, `c/[token]`. No dead destinations found.

## Still open (frontend)

- Dialog focus/Escape behavior needs a real keyboard/screen-reader run
  (FIND-006 class).
- Search filters not implemented (FIND-008, LOW).
- Keyboard-only navigation and VoiceOver/TalkBack runs not performed (hardware).