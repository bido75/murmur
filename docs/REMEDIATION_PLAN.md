# Remediation plan

Backlog from `murmur-all-app-testing-report.txt` and
`murmur-settings-page-testing-report.txt`, each finding verified against the source
before being acted on. A browser automation tool reporting an element as broken is
not treated as proof.

Status: VERIFIED, PARTIAL, BROKEN, FALSE POSITIVE, BLOCKED, NOT TESTED.

## Traceability matrix

| # | Audit finding | Module | Verified status | Correction | Status |
|---|---|---|---|---|---|
| 1 | Field Mode ON overwrites the saved default type, OFF does not restore it | `src/app/(tabs)/settings.tsx`, `src/app/record.tsx` | VERIFIED | Field Mode is now an independent override; the chosen default is never overwritten. New recordings use `site_walk` only while Field Mode is on. | FIXED |
| 2 | Radio buttons expose no checked state | `src/app/record.tsx`, `src/app/privacy.tsx`, `src/app/deck.tsx`, `src/app/templates.tsx`, `src/components/ProjectPicker.tsx`, `src/app/(tabs)/settings.tsx` | VERIFIED | `accessibilityRole="radio"` used `accessibilityState.selected`; radios now use `checked`. The `Segmented` tab component correctly keeps `selected`. | FIXED |
| 3 | Hardcoded MCP endpoint `http://10.0.0.180:8090/mcp` | `src/app/api-access.tsx` | FALSE POSITIVE | The endpoint derives from `APP_URL` / `SUPABASE_URL` in `@/lib/config`; the LAN address came from the local `.env.local`, which is correct locally. | NO CHANGE |
| 4 | `/webhooks` returns 404 | `src/app/(tabs)/settings.tsx` | FALSE POSITIVE | "Webhooks & REST API" routes to `/developers`, which exists. | NO CHANGE |
| 5 | Dialog / menu Cancel and Close do not close | `src/components/ui.tsx` | NOT TESTED | Not reproduced by source inspection; menus are dismissible (backdrop/Escape). Needs a real keyboard/browser run. | OPEN |
| 6 | Hidden elements in the accessibility tree | projects/settings fields | NOT TESTED | Likely correct conditional visibility; no accidental hiding found. | OPEN |
| 7 | Settings persistence across devices | `src/lib/api.ts` (`getSettings`/`saveSettings` via AsyncStorage) | PARTIAL | General settings persist locally only; transcription settings already persist in `user_settings`. Moving all settings server-side is a later sprint. | OPEN |
| 8 | Uploads shows a static "Everything is uploaded" | `src/app/(tabs)/settings.tsx`, `src/lib/sync.ts` | PARTIAL | The upload queue and retry exist in `sync.ts`; the Settings row is static. Surfacing live queue state is a later sprint. | OPEN |
| 9 | Calendar OAuth | `src/app/(tabs)/settings.tsx` | BLOCKED | Explicit "not configured on the server" state is correct; needs Google/Microsoft app registration and credentials. | BLOCKED |
| 10 | External connections, teams, automations, devices, phone, reels, templates, API access | `src/app/integrations.tsx`, `src/app/automations.tsx`, `src/app/devices.tsx`, `src/app/phone.tsx`, `src/app/templates.tsx`, `src/app/api-access.tsx` | PARTIAL | Pages exist and are wired; live OAuth / provisioning actions need per-provider credentials and are BLOCKED until then. | PARTIAL |

## Priorities for the next sprints

1. **Persistence**: move general settings (`consentReminder`, `fieldMode`, `defaultTemplate`, `myState`) into `user_settings` so they sync across devices, with optimistic updates and rollback.
2. **Uploads**: surface the real queue (pending / uploading / failed / retry) from `sync.ts` on the Settings row.
3. **Search**: add filters and result snippets over recordings, transcripts, notes, projects and tasks.
4. **Ask AI**: confirm citations are enforced on the `ask` endpoint.
5. **Dialog focus management** on web (Escape, focus return, backdrop close).
6. **Integrations**: complete OAuth flows per provider behind "not configured" states; mark live verification BLOCKED until credentials exist.
7. **Telephony / watch pairing**: BLOCKED until accounts and hardware are available.
