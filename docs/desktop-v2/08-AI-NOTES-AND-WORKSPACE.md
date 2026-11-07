# AI notes and workspace (Desktop V2, Phase 4)

Status as of 2026-10-29. The desktop is deliberately the recording + dictation client
in this phase; heavy workspace surfaces already exist in the web app and open in the
system browser by design.

## What the desktop does today

| Surface | Status | Where |
|---|---|---|
| Notes/summaries generation | IMPLEMENTED (shared pipeline) — recordings go through the same `process-recording` Edge Function as web/mobile; summaries, tasks and highlights are produced server-side | `renderer/sync.ts` outbox → functions |
| Notes display | PARTIAL — recent recordings list opens the full notes view in the web app (`APP_URL/recording/{id}`); a native transcript viewer is Phase 5 work | `app.ts` homeView recent card |
| Projects | PARTIAL — recording can be associated with a project at start (`form.projectId`, projects fetched for the picker); a project-management screen is Phase 5 | `app.ts`, `sync.ts` |
| Tasks | DEFERRED — server-extracted tasks are visible in the web app; a desktop tasks screen is not built yet and is not faked | — |
| Search / Ask Murmur | DEFERRED — depends on the web app's search+ask endpoints; desktop entry lands with the transcript viewer (Phase 5). No decorative nav items were added for unbuilt surfaces | — |
| Settings screen | IMPLEMENTED BUT NOT E2E-TESTED — account-wide fields (default type, consent reminder, field mode, my_state) with live write-through to `user_settings`; device-only settings (localOnly) stay with the speech panel | `app.ts settingsView()` + `changeSettings()` |
| Onboarding checklist | IMPLEMENTED — derived from real data via the **shared** web module (`src/lib/onboarding.ts` imported directly into the desktop bundle; single definition, no duplicate logic). Progress events go to `onboarding_events`; `user_onboarding` row is updated (checklist_hidden, first_ready_opened_at stamp on opening a recording) | `renderer/onboarding.ts` + homeView card |
| Full spotlight tour | DEFERRED to Phase 5 — the checklist covers the desktop's core flow (sign in → mic → model → record → notes); the 7-stop overlay tour port needs anchor work in the desktop layout | — |

## Shared-code convergence (D-02)

- `desktop/src/renderer/onboarding.ts` imports the web's pure onboarding module
  directly (`../../../src/lib/onboarding.ts`): `checklist`, `checklistProgress`,
  `CHECKLIST_TOTAL` and the `ChecklistData` types come from one source.
- `desktop/build.mjs` now defines `process.env.EXPO_PUBLIC_*` for the browser bundle,
  so shared modules that read those values boot in the renderer (verified: no
  `process.env` expression remains in the emitted bundle).
- Execution evidence: `MURMUR_SMOKE_SHOT` boot check passed
  (`SMOKE bridge-isolated true`) with the shared code in the bundle.

## Model management hardening (from the audit gap list)

- **Disk-space pre-check**: `installModel` now measures free bytes with `fs.statfs`
  before downloading and refuses with the real numbers when the archive plus a 512 MB
  unpack margin would not fit. A statfs failure does not block install (digest checks
  still guard the result).
- Existing guarantees unchanged: HTTPS pinned release URL, archive + per-file SHA-256,
  version marker, cancel/abort, explicit user action only.
