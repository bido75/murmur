# Murmur AI Desktop V2 — Phase 0 Baseline Audit

Date: 2026-10-29 · Branch: `feature/murmur-desktop-v2` (cut from `feature/murmur-app-remediation` @ `2d0cb0d`) · Scope: existing `desktop/` Electron codebase, before any V2 work.

## 1. Baseline verification (all executed on this branch)

| Command | Result |
|---|---|
| `git status --short` | 57 uncommitted files, all shared-lib quote-normalization, none under `desktop/` |
| `npm run typecheck` (desktop) | clean, 0 errors |
| `npm test` (desktop) | **92 pass / 0 fail / 2 skipped** (skips are the engine integration tests requiring the ONNX model) |
| `git log --oneline -5` | HEAD `2d0cb0d` auto-start stack; security chain `c71b345`/`2065aac` present |
| `git merge-base main HEAD` | `8d7ef81` — branch remains fast-forwardable to main |

Baseline is green. No V2 code may be written before this file exists (done).

Branch decision: branched **in place** rather than via worktree because (a) the 57 uncommitted files touch only `src/`, not `desktop/`, so there is no conflict risk; (b) a worktree would need a fresh 400+ MB `desktop/node_modules` install; (c) desktop commits stage explicit paths only, so the uncommitted work cannot be swept in.

## 2. Inventory (62 source files, no vendored code)

| Area | Files | Roles |
|---|---|---|
| `src/main/` | `main.ts` (635 ln), `dictation.ts`, `speechModelManager.ts`, `transcriber.ts`, `parakeet/engine.ts`, `resources.ts`, `preload.ts`, `overlayPreload.ts` | window/tray/lifecycle, meeting detection (tasklist/ps + window titles), segment file store + queue JSON persistence, ~40 IPC handlers, macOS ScreenCaptureKit helper spawn, model install/remove, ONNX transcription, global-shortcut dictation with overlay window |
| `src/renderer/` | `app.ts` (25 KB), `capture.ts`, `sync.ts`, `speech.ts`, `dictation*.ts`, `history*.ts`, `speechPanel.ts`, `live.ts`, `supabase.ts`, `config.ts`, `index.html`, `overlay.html`, `pcm-worklet.js`, `styles.css` | vanilla-JS UI (no framework), MediaRecorder WebM/Opus stereo capture (mic left, system right), 5-minute segment rotation + crash-safe appends, upload outbox with retry, local-STT dispatch |
| `src/shared/` | `bridge.ts`, `meetings.ts`, `queue.ts`, `dictionary.ts`, `formatting.ts`, `history.ts`, `insert.ts`, `parakeet.ts`, `pcm.ts`, `shortcuts.ts`, `transcription/` + 9 `*.test.ts` | typed IPC surface (`Bridge`), retryable outbox ops, dictionary/formatting/insert pipelines, 92 unit tests |
| `native/macos/` | `SystemAudioCapture.swift`, `build.sh` | loopback system audio (float32 mono 48 kHz over stdout) |
| build | `build.mjs` (esbuild: main/preload CJS node22, renderer IIFE chrome140), `electron-builder.yml`, `tsconfig.json` (strict) | env inlined at build time from `../.env` via `EXPO_PUBLIC_*` names |
| tests | 9 test files, node:test with `--experimental-strip-types` | unit-level; no E2E harness |

## 3. Security posture (observed, preserved in V2)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all windows.
- Permission handler allows only `file://` origins and only `media`/`display-capture`.
- `setWindowOpenHandler` denies everything except `https://` → system browser; `will-navigate` prevented.
- Segment paths are derived server-side (main) from sanitized `(recordingId, idx, ext)` — renderer cannot name arbitrary files.
- Single-instance lock; tray close = hide, explicit quit.
- Gaps found: `appId: com.example.murmur.desktop` is a placeholder; no code signing (win), no notarization creds (mac), no auto-update, no renderer CSP meta, no crash/telemetry pipeline, no CI build lane, no linux target.

## 4. Backend contracts (from `docs/DESKTOP_INTEGRATION_HANDOFF.md` + audit copy)

| Contract | Status | Desktop obligation |
|---|---|---|
| Auth (Supabase JWT, same project + anon key) | unchanged | keep |
| `user_settings` (`consent_reminder`, `field_mode`, `default_template`, `my_state`) | **changed — server-backed** | read from server; never write `default_template` when toggling field mode; field mode is an override, turning it off restores the saved preference |
| Recording IDs / utterance shape `{start_ms, end_ms, speaker, text}` | unchanged | keep |
| `process-recording` contract | unchanged | keep |
| Storage signed URLs | **changed** (host-rewritten via `clientUrl`) | consuming client needs no change; never build server URLs from `SUPABASE_URL` on a local stack — use `EXTERNAL_SUPABASE_URL` |
| OAuth redirect base | **changed** (`EXTERNAL_SUPABASE_URL` precedence) | desktop calendar/connect/procore flows inherit; desktop-initiated OAuth must use `PUBLIC_API_BASE_URL`/`APP_URL` origins |
| Webhook SSRF check | **changed** | any webhook editor must surface "public https URL" |
| Migrations | `20261025010000_user_prefs.sql`, `20261025021000_webhook_ssrf.sql` (additive) | must be applied to any environment the desktop points at |

## 5. Current-state gaps vs the V2 scope

1. **Auth**: email OTP only (`signInWithOtp`/`verifyOtp`, `app.ts:177,215`). No OAuth provider flows, no PKCE, no deep-link/loopback callback channel — Phase 2 must add these.
2. **Settings**: consent/field-mode live in form state (`app.ts:58,84`); only `language` is read from `user_settings` (`sync.ts:131`). Server-backed preferences are required by the handoff.
3. **Packaging**: placeholder appId, no signing, no auto-update, no CI lane, no linux target.
4. **Onboarding**: web shipped a 7-stop tour (`88b3d8c`); desktop has none.
5. **Shared-code drift**: `desktop/src/shared` duplicates logic that `src/lib` (web/mobile) also maintains (`api.ts` contracts, `config.ts`, `types.ts`) — alignment needed without a risky big-bang dedupe.
6. **Observability**: no crash capture or opt-in telemetry; release verification for desktop must rely on logs + selftest/smoke hooks (`MURMUR_SELFTEST`, `MURMUR_SMOKE_SHOT` — good bones to build on).

## 6. Known environment constraints (carried from the release audit)

- Native audio capture, Whisper/Parakeet runtimes, code signing and notarization cannot be exercised in this environment (no hardware/mic, no signing credentials). Related matrix rows will be marked `NOT TESTED`/`BLOCKED` rather than claimed.
- AGPL: Murmure remains study-only reference; no source copying. Parakeet weights are CC BY 4.0 with attribution already shipped — legal sign-off (`BL-LEGAL`) is still a distribution gate.

## 7. Acceptance

- [x] Baseline verified green before branching (§1)
- [x] Full handoff contract table recorded (§4)
- [x] Gap list driving the phase plan (§5)
- [ ] Architecture map + matrix reviewed before Phase 1 code (see `02-ARCHITECTURE.md`, `03-IMPLEMENTATION-MATRIX.csv`)
