# Windows installer (Desktop V2 distribution)

## What gets built

`Murmur-Setup-<version>-win-x64.exe` — an NSIS per-user installer (electron-builder
26.15.3, NSIS target, x64).

## Verified properties (from the local build, `desktop/release/`)

| Property | Status | Evidence |
|---|---|---|
| Real NSIS installer produced | VERIFIED | `Murmur-Setup-0.1.0-win-x64.exe`, 127.4 MB (after per-platform pruning; 177.4 MB before) |
| Per-user install (`perMachine: false`, `oneClick: false`) | CONFIGURED | `electron-builder.yml` nsis block; the wizard lets the user choose the directory |
| Start-menu shortcut | CONFIGURED | `createStartMenuShortcut: true`, name "Murmur" |
| Uninstall support | CONFIGURED | NSIS uninstaller + `uninstallDisplayName: Murmur` |
| App icon | VERIFIED | `desktop/build/icon.png` (the app's real 1024×1024 icon, converted by electron-builder) |
| Version + publisher metadata | PARTIAL — version stamps correctly; publisher/legal entity pending the identity decision | `npm version` stamp step in CI |
| Upgrade compatibility | CONFIGURED for same-appId upgrades (NSIS default); **blocked on the appId decision** — see below | — |
| App-data preservation | CONFIGURED — `deleteAppDataOnUninstall: false`; recordings live in `%APPDATA%/Murmur` and survive uninstall/reinstall | — |
| Required native binaries | VERIFIED — `onnxruntime-node` unpacked outside the asar (`app.asar.unpacked/.../win32/x64` present; `darwin` pruned) | electron-builder smart unpack + explicit asarUnpack |
| Update metadata (latest.yml + blockmap) | PRODUCED — needed by electron-updater once signed releases exist | release/ output |
| **Code signing** | **NOT SIGNED** — `Get-AuthenticodeSignature` → `NotSigned`. electron-builder's signtool lines are its default no-op pass, not a signature | honest measurement, not assumption |

## The SmartScreen reality (stated plainly)

An unsigned installer is not broken — it is untrusted-looking. Users see
"Windows protected your PC" and must choose *More info → Run anyway*. This is
acceptable only for restricted testing. Signing does **not** grant instant SmartScreen
reputation either: reputation accrues to a certificate over downloads. Both facts are
recorded here so nobody over-promises.

## Signing path (when credentials exist)

- Secrets: `WINDOWS_SIGNING_PFX` (certificate, base64) + `WINDOWS_SIGNING_PFX_PASSWORD`
  as GitHub Actions secrets — never files in the repo.
- The workflow's Windows gate currently **fails the build** if secrets exist but the
  signing step is not implemented; when implementing, use `electron-builder`
  `signtoolOptions`/custom sign hook reading the PFX from a decrypted temp file that
  is deleted in a `always()` step.
- Timestamping: use an RFC 3161 timestamp server so signatures outlive the certificate.

## Installer acceptance status

Marked in `07-INSTALLATION-TESTS.md`: CI packaging success is **not** an install pass;
real Windows installation tests are BLOCKED pending a test machine + user.
