# Windows Installation Test Report

**Date:** 2026-11-03
**Installer:** `Murmur-Setup-0.1.0-win-x64.exe` (127.4 MB, SHA-256: `F95047EA…`)
**Machine:** Windows development machine (the operator's computer)
**Install method:** NSIS `/S` (silent install)

## Results

| Test | Status | Evidence |
|---|---|---|
| Installer runs without error | ✅ PASS | `/S` completed, exit code 0 |
| App installed to `%LOCALAPPDATA%\Programs\Murmur` | ✅ PASS | directory exists with all files |
| `Murmur.exe` present (234.4 MB) | ✅ PASS | Electron binary with all runtime files |
| `app.asar` present (11.2 MB) | ✅ PASS | application code archive |
| `onnxruntime-node` unpacked outside asar | ✅ PASS | `app.asar.unpacked/node_modules/onnxruntime-node` present |
| Start Menu shortcut created | ✅ PASS | `Murmur.lnk` in Start Menu Programs |
| Uninstaller present | ✅ PASS | `Uninstall Murmur.exe` (0.2 MB) |
| App launches | ✅ PASS | Electron process started (killed for cleanup) |
| Per-user install (no admin needed) | ✅ PASS | installed without elevation |
| `app-update.yml` present | ✅ PASS | electron-updater metadata for future updates |
| `ffmpeg.dll` present | ✅ PASS | Chromium media codec support |
| No dev server dependency | ✅ PASS | standalone install, no Metro connection needed |

## NOT TESTED on this machine

| Test | Reason |
|---|---|
| Microphone recording | Requires the operator to grant browser/OS permissions and test with a real microphone |
| Local transcription (ONNX) | Requires the speech model to be downloaded and real audio |
| Translation | Requires sign-in and a recording to translate |
| Export | Requires sign-in and a recording |
| Upgrade | Requires a previous version to upgrade from |
| Uninstall | Not tested (would remove the installed app) |

## What the installed app contains (from `app.asar.unpacked`)

- `onnxruntime-node` with per-platform binaries (win32/x64 kept, darwin/linux/arm64 pruned)
- No `global-agent` test files
- No test files of any kind
- `app-update.yml` for electron-updater
- `elevate.exe` for NSIS elevation

## Security observations

- The installer is **unsigned** — Windows SmartScreen will warn
- The app installs per-user (no admin rights needed) — this is the NSIS `perMachine: false` setting
- No service-role keys or provider secrets in the installed files
- The `app.asar` contains only the bundled application code, not raw source
