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

## P0 crash fix verification (2026-11-03)

The first installer crashed on launch:

```
TypeError: Cannot destructure property 'autoUpdater'
of 'import_electron_updater.default' as it is undefined.
```

Root cause: `electron-updater` v6.8.11 has NO default export — the default import resolved to `undefined` in the esbuild-bundled CJS output.

Fix (commit `d84aa79`): named import `{ autoUpdater }` from `electron-updater` + added to esbuild externals.

| Test | Status |
|---|---|
| Fixed installer built | ✅ 127.3 MB |
| Fixed installer SHA-256 | ✅ `D2A008A88D8C0F303AD309336518ACD8D6F4AA87336C2A8116B7E6D899654B14` |
| Old version uninstalled | ✅ |
| Fixed version installed (silent /S) | ✅ |
| App launched (smoke test) | ✅ **exit code 0, no crash** |
| Screenshot captured | ✅ 639×915 |
| Process exited cleanly | ✅ exit 0 |

The P0 startup crash is **FIXED**. The installed application launches without a main-process JavaScript exception.

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
