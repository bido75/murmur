# Implementation log

Branch: `feature/murmur-app-remediation` (from `feature/transcription-local`).

## 2026-10-25 — Phase 3: account-settings persistence

- Added `consent_reminder`, `field_mode`, `default_template`, `my_state` columns to
  `user_settings` (migration `20261025010000_user_prefs.sql`).
- `getSettings` now merges those account prefs with the per-device transcription
  choices (which stay in AsyncStorage); `saveSettings` writes both and throws so the
  caller can roll back.
- The Settings screen shows a Saved indicator and rolls back with an error toast on
  failure.
- Added a DB security test proving the owner reads/writes their own prefs and no one
  else's. (`supabase/tests/sharing.test.mjs`)

## Phase 4/5 verification (no code needed)

The audits flagged these as missing; source inspection shows they are already
implemented and wired, seen only in their empty/initial render state:

- **Search / Ask AI** (`src/app/(tabs)/search.tsx`, 269 lines): debounced search over
  recordings and tasks, plus a question-taking assistant, backed by
  `search_recordings` / `search_tasks` RPCs and the `ask` function. A DB test covers
  the search RLS.
- **Uploads** already shows a live pending count and a Retry action.
- **Settings sub-pages** — Webhooks/API (`/developers`), connections, devices,
  automations, templates, phone, reels, privacy, API access — all exist and are
  wired; live OAuth and telephony provisioning remain BLOCKED on external
  credentials.

## 2026-10-25 — Sprint 1: verified findings and fixes

### Fixed

1. **Field Mode no longer destroys the user's default recording type.**
   - `src/app/(tabs)/settings.tsx`: the Field Mode switch now toggles only
     `fieldMode`, instead of also writing `defaultTemplate: "site_walk"`. A note is
     shown under "Default type" while Field Mode is on.
   - `src/app/record.tsx`: the initial type for a new recording is
     `fieldMode ? "site_walk" : defaultTemplate`, so Field Mode overrides the
     *effective* default without overwriting the preference.

2. **Radio buttons expose correct screen-reader state.**
   - Radios used `accessibilityRole="radio"` with
     `accessibilityState={{ selected }}`; `selected` is for tabs. They now use
     `checked` across `record`, `privacy`, `deck`, `templates`, `ProjectPicker`
     and `settings`. The `Segmented` tab component in `ui.tsx` correctly keeps
     `selected`.

### Verified not broken

3. **MCP endpoint** (`src/app/api-access.tsx`) is derived from `APP_URL` /
   `SUPABASE_URL`, not hardcoded. The audit saw the LAN address because
   `EXPO_PUBLIC_APP_URL` is `http://10.0.0.180:8090` in `.env.local`.
4. **"Webhooks & REST API"** routes to `/developers`, which exists; the `/webhooks`
   404 in the audit was a wrong path.

### Not started (deferred to later sprints)

- Settings cross-device persistence (currently AsyncStorage; transcription
  settings already live in `user_settings`).
- Live upload queue on the Settings row.
- Search filters and Ask-AI citation verification.
- Web dialog focus management.
- OAuth-based integrations, telephony and watch pairing — BLOCKED on external
  credentials/hardware.

## Checks

- `npx tsc --noEmit` — clean.
- `npx expo lint` — clean.
- `deno test --allow-all _shared/` — 178 pass.
- `npm test` — 174 logic + 10 app + 75 database security pass.
