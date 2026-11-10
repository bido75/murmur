# Test results (Desktop V2, Phase 7 final)

Date: 2026-10-29 · Branch `feature/murmur-desktop-v2` · Full data in `test-results.json`.

## Executed (real commands, this environment)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean, 0 errors (final + every phase) |
| Unit tests | `npm test` | **153 pass / 0 fail / 2 skipped** (92 baseline preserved + 61 added across phases 1–7) |
| Build | `node build.mjs` | pass every phase; final bundle includes floating preload + HTML |
| Live boot smoke | `MURMUR_SMOKE_SHOT=… npx electron .` | `SMOKE bridge-isolated true`, screenshot captured (run in phases 4, 5, 7) |
| Live OAuth loopback | `node --test src/main/auth.test.ts` | real HTTP roundtrip captured the code; state mismatch and second delivery rejected |
| CI | `.github/workflows/desktop.yml` on windows-latest + macos-latest | runs on push; SHA-pinned actions |

Skips are the Parakeet engine integration tests, which require the downloaded ONNX model.

## Not claimed (needs hardware/credentials)

- Signed-in end-to-end run (record → process → notes) against live Supabase.
- System-audio loopback (Windows) / ScreenCaptureKit (macOS) on real devices; drift measurement over a 60-minute recording.
- ONNX inference soak with real audio.
- Installer execution on clean machines; signing/notarization.

## Baseline regression guard

All 92 baseline tests pass unchanged; every phase's commits touched the existing test
suite only additively. Capture behavior changes were refactor-to-tested-module only
(level math, silence guard, short-segment rule — formulas preserved and now covered).
