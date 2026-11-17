# macOS installer (Desktop V2 distribution)

## What gets built

Two architecture-specific builds (macos-latest = Apple Silicon, macos-13 = Intel):

- `Murmur-<version>-arm64.dmg` + `Murmur-<version>-arm64.zip`
- `Murmur-<version>-x64.dmg` + `Murmur-<version>-x64.zip`

The zip exists because electron-updater consumes zip artifacts for macOS delta-free
updates once signed builds ship.

## Build requirements handled in the workflow

| Requirement | How |
|---|---|
| System-audio helper binary | `npm run mac-helper` (swiftc, present on GitHub runners) runs before packaging; the `extraResources` mapping fails the build if the binary is missing, so a helper-less DMG cannot ship silently |
| Helper inclusion verified | the CI step lists the zip and requires `SystemAudioCapture` and `Contents/MacOS/Murmur` or fails |
| Per-architecture onnxruntime | the other arch's `darwin/x64` (or `arm64`) folder is deleted before packaging; the win/linux folders are excluded in `electron-builder.yml` |
| Hardened runtime + entitlements | `hardenedRuntime: true`, `build/entitlements.mac.plist` inherited |
| Permission strings | `NSMicrophoneUsageDescription` + `NSScreenCaptureUsageDescription` in `extendInfo` |
| Icon | the app's real 1024×1024 icon; electron-builder produces the `.icns` on the runner (iconutil) |
| Gatekeeper assessment | `gatekeeperAssess: false` — verification is a separate, explicit step (below), not a side effect |

## Signature/notarization status (honest)

**Unsigned.** No Developer ID certificate is configured. Consequences, which the
release notes repeat verbatim:

- Gatekeeper blocks first launch: the user must right-click → Open (or approve in
  System Settings). **The docs never instruct disabling Gatekeeper or removing
  quarantine as a routine step** — that guidance is reserved for the signed path.
- Notarization (`stapler`) requires Developer ID credentials plus an app-specific
  password; the workflow's macOS gate fails the build if those secrets appear before
  the notarization step is implemented.

## Verification tooling (used when signed; usable now for checks)

- `codesign -dv --verbose=4 Murmur.app` — identity, authority, flags (runtime).
- `codesign --verify --deep --strict Murmur.app` — integrity.
- `spctl -a -vv Murmur.app` — Gatekeeper assessment (only meaningful when signed).
- `xcrun stapler validate Murmur.app` — notarization ticket (only when notarized).

For the unsigned test builds, CI verifies structure and contents only; the signing
rows in `07-INSTALLATION-TESTS.md` stay BLOCKED rather than PASS.
