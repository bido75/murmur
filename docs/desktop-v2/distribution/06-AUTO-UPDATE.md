# Auto-update (Desktop V2 distribution)

## Status: implemented, gated, dormant by default

The plumbing exists; the gate is shut on purpose.

| Piece | State | Where |
|---|---|---|
| Update decision logic | IMPLEMENTED AND VERIFIED (7 unit tests) | `desktop/src/main/updater.ts` |
| electron-updater wiring | IMPLEMENTED BUT NOT LIVE-TESTED — behind the gate; checks GitHub Releases (provider configured in `electron-builder.yml`), `autoDownload: false`, version comparison, error capture | `desktop/src/main/updaterRuntime.ts` |
| Renderer surface | `bridge.updatesStatus()` wired through preload/IPC; a settings-screen row lands with the next UI pass | `bridge.ts`, `main.ts` |
| Gate | Three conditions, ALL required: signed installers verified on the platform, `MURMUR_ENABLE_UPDATES=1` set by the operator, and a stable (non-prerelease) build. Currently the first is hard-coded false — unsigned builds never self-update | `updatesEnabled()` |

## Behavior once enabled (signed, stable builds only)

1. App checks the `publish` GitHub provider feed (`latest.yml` for win; zip-based for mac).
2. If `isNewerVersion(latest, current)`, the UI reports "An update is available." — the
   user explicitly chooses to download (no silent replacement).
3. Download progress and the install/restart prompt are electron-updater stock
   behaviors that the settings UI will surface; errors land in the update status and
   the local crash log.

## Why the gate is stricter than the code needs to be

An updater is an executable-replacement channel. Pointing it at unsigned artifacts
means anyone who can push a draft release could replace users' apps. The gate
(`signingVerified: false` until both platforms verify signed installs) makes that
attack require a code change, not just a release. The tests pin this behavior so a
future refactor cannot silently loosen it.

## Enablement checklist (operator + developer)

1. Signing live on Windows and macOS (04-SIGNING-NOTARIZATION.md).
2. One signed release installed and verified per platform (07-INSTALLATION-TESTS.md).
3. Set `MURMUR_ENABLE_UPDATES=1` in the packaged environment.
4. Flip the `signingVerified` constant in `main.ts` `updates:status` to a real
   signal (e.g., presence of a valid signature on the running binary, checked at startup).
5. Verify an actual update flow: old signed build → publish newer signed release →
   check → download → restart → version advanced, data intact.
