# Murmur AI Desktop V2 — Architecture

## Current architecture (Phase 0 observed)

```
desktop/
├─ build.mjs               esbuild bundler; env inlined (EXPO_PUBLIC_SUPABASE_URL/ANON_KEY/APP_URL)
├─ electron-builder.yml    mac (dmg/zip, hardened) + win (nsis); appId placeholder; no linux
├─ src/
│  ├─ main/                Electron main process
│  │  ├─ main.ts           windows, tray, lifecycle, meeting detection, segment store,
│  │  │                    queue/active/text JSON persistence, ~40 IPC handlers,
│  │  │                    macOS system-audio helper, model install, local transcription
│  │  ├─ dictation.ts      global shortcuts + overlay window + clipboard/type/paste insert
│  │  ├─ speechModelManager.ts  Parakeet model download/install/remove (userData)
│  │  ├─ transcriber.ts    onnxruntime-node inference entry
│  │  ├─ parakeet/engine.ts encoder/decoder-joint ONNX pipeline
│  │  └─ resources.ts      resource stats
│  ├─ preload.ts / overlayPreload.ts   contextBridge surfaces (renderer sandboxed)
│  ├─ renderer/            vanilla-JS UI
│  │  ├─ app.ts            screens, recording form, settings, history
│  │  ├─ capture.ts        MediaRecorder mic+system (stereo), 5-min segments, appends
│  │  ├─ sync.ts           outbox: upload segments → process-recording → fetch results
│  │  ├─ speech.ts         local vs cloud transcription dispatch (localStorage flag)
│  │  ├─ supabase.ts       supabase-js client (persistSession, no URL detection)
│  │  └─ live/dictation/history views
│  ├─ shared/              bridge.ts (typed IPC), queue.ts (retry ops), meetings/pcm/
│  │                       dictionary/formatting/insert/shortcuts + 9 test files
└─ native/macos/SystemAudioCapture.swift  loopback helper (stdout PCM 48k)
```

Data flow: `capture.ts` → main writes `userData/pending/{id}-{idx}.webm` → `queue.ts` ops persisted in `userData/queue.json` → `sync.ts` uploads to Storage, calls `process-recording`, downloads transcript/summary. Local mode keeps everything on disk and transcribes via ONNX in main.

## V2 target deltas (phase-mapped)

| # | Change | Where | Notes |
|---|---|---|---|
| D1 | OAuth providers (Google/Apple) + PKCE with deep-link/loopback callback channel | main (`auth.ts` new: temp loopback HTTP listener + `app.open-url`/custom protocol), renderer sign-in | OTP stays as fallback; redirect URIs must match the registered `EXTERNAL_SUPABASE_URL` callbacks |
| D2 | Server-backed `user_settings` (consent_reminder, field_mode, default_template, my_state) | renderer settings module | write-through on change, read-on-launch + subscribe; **never** write `default_template` on field-mode toggle |
| D3 | Shared-contract alignment with `src/lib` (types, utterance shape, queue op fields) | `desktop/src/shared` | adopt web's `types.ts` shapes where compatible; no big-bang dedupe — targeted convergence with tests |
| D4 | Onboarding tour (port of web's 7-stop tour/checklist) | renderer | same analytics events as web (`onboarding_events`), gated by server-backed prefs |
| D5 | Packaging hygiene | `electron-builder.yml` | real appId (`com.giscop.murmur.desktop` pending confirmation), win signing prep (blocked on cert), linux target optional, asar integrity config |
| D6 | Auto-update plumbing | main + CI | electron-updater against a generic/CF-R2 feed; enablement gated on signing credentials (recorded as blocked otherwise) |
| D7 | Crash/diagnostics | main | local rotating logs + `MURMUR_SELFTEST`/smoke harness extension; opt-in telemetry only, off by default |
| D8 | CI lane | `.github/workflows/desktop.yml` | lint+typecheck+tests+build on win/mac runners; artifact upload unsigned |
| D9 | Webhook editor guard | renderer settings | "public https URL" copy per SSRF handoff |
| D10 | Security hardening parity | renderer CSP meta, session defaults | mirror web's headers within the Electron context |

## Out of scope / blocked in this environment

- Real code signing (win cert), notarization (Apple ID) — credentials absent; plumbing prepared, enablement blocked.
- Live mic/system-audio soak tests, Whisper/Parakeet runtime soak on real audio hardware.
- Any AGPL-derived code.

## Phase plan (traces to `03-IMPLEMENTATION-MATRIX.csv`)

1. **Phase 1 — Foundation**: D3 (contracts), D5 hygiene, D8 CI lane, tsconfig/test harness refresh.
2. **Phase 2 — Auth & settings**: D1, D2, D9.
3. **Phase 3 — Capture & transcription parity**: capture robustness, local-STT dispatch tests, webhook/copy fixes.
4. **Phase 4 — Onboarding & UX parity**: D4, tour analytics.
5. **Phase 5 — Packaging & distribution prep**: D5/D6 wiring, unsigned smoke artifacts.
6. **Phase 6 — Observability & release verification**: D7, `docs/desktop-v2/release-verification/`.
7. **Phase 7 — Hardening & handoff**: security review, final matrix, PR.
