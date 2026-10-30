# Signing and notarization (Desktop V2 distribution)

## Current status: UNSIGNED, and labeled as such everywhere

Every unsigned build is announced in the CI log, named a test/pre-release, and carries
release notes that say "UNSIGNED" in the title. The workflow actively refuses to build
if signing secrets exist but the signing steps are not yet implemented — no
half-signed artifacts.

## Windows (Authenticode)

| Item | Requirement |
|---|---|
| Certificate | OV or EV code-signing certificate (EV gives faster SmartScreen reputation but still accrues over time) |
| Secrets | `WINDOWS_SIGNING_PFX` (base64 PFX), `WINDOWS_SIGNING_PFX_PASSWORD` — GitHub Actions secrets only |
| Implementation point | `desktop-release.yml` Windows gate step; replace the refusal with the electron-builder sign hook |
| Timestamping | RFC 3161 TSA required, or signatures die with the certificate |
| Post-signing truth | SmartScreen reputation still builds gradually; "signed" ≠ "no warning on first download" |

## macOS (Developer ID + notarization)

| Item | Requirement |
|---|---|
| Certificate | Apple Developer ID Application certificate (paid Apple Developer Program) |
| Secrets | `APPLE_CERTIFICATE` (base64 P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Implementation point | `desktop-release.yml` macOS gate step; electron-builder natively consumes these env vars (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) — map them and enable `notarize: true` |
| Verification | `codesign --verify --deep --strict`, `spctl -a -vv`, `xcrun stapler validate` (03-MACOS-INSTALLER.md) |
| Hardened runtime | already enabled in the config — required for notarization, so no rework needed |

## The trust-model rule for updates

`electron-updater` only auto-updates **signed** builds on macOS (Squirrel.Mac refuses
unsigned). Windows NSIS updates work unsigned but inherit the same trust weakness as
the installer. The desktop's update gate (`desktop/src/main/updater.ts`) therefore
requires a `signingVerified` fact that is hard-coded `false` until both platforms have
signed artifacts verified by the acceptance tests in `07-INSTALLATION-TESTS.md`.
Unsigned update feeds are never treated as production updates.

## What the operator must supply (summary)

1. Windows code-signing certificate + decide OV vs EV.
2. Apple Developer Program membership + Developer ID certificate + app-specific
   password.
3. Confirmation of the permanent app id (`com.giscop.murmur` proposed, pending domain
   verification) — signing identities should match the publisher name.
