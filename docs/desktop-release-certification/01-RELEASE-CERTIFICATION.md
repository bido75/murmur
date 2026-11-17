# Desktop Release Certification — Build 3 (restricted test)

**Date:** 2026-11-03
**Branch:** `feature/murmur-desktop-v2` · **Commit:** `5c5d1b2` (latest P1-fixes HEAD)
**Workflow:** `desktop-release.yml` · **Run:** https://github.com/bido75/murmur/actions/runs/41596871379
**Trigger:** tag `desktop-v0.1.0-build3`

## Artifacts

| Platform | Artifact | Size | SHA-256 (verified locally = CI) |
|---|---|---|---|
| Windows x64 | `Murmur-Setup-0.1.0-win-x64.exe` | 127.4 MB | `F95047EAC7A5CB77AABF69339BB06B3651CA5FD78015BD67FA093D8A9E528870` |
| macOS arm64 (DMG) | `Murmur-0.1.0-arm64.dmg` | 151.8 MB | `72585488407D2540A6EE7B667C5D4A4BEE86215D3B5F019AFF4C181D0FBE4409` |
| macOS arm64 (ZIP, for electron-updater) | `Murmur-0.1.0-arm64.zip` | 150.4 MB | `4EA44D06CDDCEA8CBCF2AFBA785C5ACF9551B2803D65D01DF867D1E5FDF9B818` |
| macOS x64 (DMG) | `Murmur-0.1.0-x64.dmg` | (Intel runner queued at write time) | PENDING |
| macOS x64 (ZIP) | `Murmur-0.1.0-x64.zip` | PENDING | PENDING |

## Verification performed

| Check | Method | Result |
|---|---|---|
| SHA-256 local = CI | `Get-FileHash` vs `SHA256SUMS.txt` | ✓ MATCH |
| NSIS installer >10 MB | CI content check | ✓ 127.4 MB |
| DMG >10 MB | CI content check | ✓ 151.8 MB |
| macOS zip contains app binary | CI `unzip -l` check | ✓ `.app/Contents/MacOS/Murmur` |
| macOS zip contains SystemAudioCapture | CI `unzip -l` check | ✓ |
| Mojibake in bundles | byte-level scan (from earlier verification) | ✓ 0 hits |
| Per-platform ONNX pruning | verified in local build (win32/x64 kept, darwin pruned) | ✓ |
| `global-agent` test files excluded | asar scan | ✓ 0 test files |
| Typecheck | `npm run typecheck` | ✓ 0 errors |
| Unit tests | `npm test` (153/0) | ✓ |
| `npm test` (root) | exit 0 (all suites) | ✓ |

## Security status

| Control | Status |
|---|---|
| Code signing (Windows) | **NOT SIGNED** — no certificate available |
| Notarization (macOS) | **NOT NOTARIZED** — no Apple Developer ID |
| Mojibake guard | ✓ (repo-wide test) |
| Secrets in installer | ✓ none (scanned) |
| Provider keys server-side | ✓ (confirmed — bundle scan clean) |
| `permissions-policy: microphone=(self)` | ✓ (server-side, live) |

## Capability matrix (desktop features)

| Feature | Windows | macOS arm64 | macOS x64 |
|---|---|---|---|
| Launch without dev server | VERIFIED (local build) | PACKAGED (CI) | PACKAGED (CI) |
| Authentication (OTP) | IMPLEMENTED (not live-tested on installer) | same | same |
| Microphone recording | IMPLEMENTED BUT NOT TESTED | same | same |
| System audio (loopback) | IMPLEMENTED BUT NOT TESTED | IMPLEMENTED BUT NOT TESTED (ScreenCaptureKit) | same |
| Local transcription (Parakeet) | IMPLEMENTED BUT NOT TESTED | same | same |
| Cloud transcription | IMPLEMENTED (Mistral Voxtral) | same | same |
| Translation (171 languages) | IMPLEMENTED AND VERIFIED | same | same |
| Export (Slack/Notion/etc.) | IMPLEMENTED (with translation overlay) | same | same |
| Searchable language picker | IMPLEMENTED AND VERIFIED | same | same |
| Offline recording + sync | IMPLEMENTED (queue + account isolation) | same | same |
| Floating controller | IMPLEMENTED (not device-tested) | same | same |
| Crash log | IMPLEMENTED AND VERIFIED | same | same |
| Update check (electron-updater) | PLUMBED, GATED OFF | same | same |
| Uninstall | CONFIGURED (NSIS per-user) | CONFIGURED (drag to trash) | same |

## What is NOT claimed

- **No end-user installation has been performed** on any machine
- **No microphone recording has been tested** on the packaged installer
- **No local transcription** has been run with the packaged ONNX model
- **macOS x64 (Intel)** build is still queued on the CI runner
- **No code signing or notarization** — builds are unsigned test artifacts
- **No upgrade path testing** (requires the app ID decision to be finalized first)
