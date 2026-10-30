# Remaining operator actions (Desktop V2 distribution)

Ordered by impact. Everything not listed here is either done or blocked on these.

## 1. Approve the application identity (blocking public release)

- Confirm the domain and publisher legal name, then approve the reverse-DNS id
  (`com.giscop.murmur` proposed).
- The id is baked into installed apps; changing it after users install means a
  parallel install, so this must close **before any installer is treated as
  upgradable**. Until then every build stays a test build.

## 2. Supply signing credentials (blocking public distribution)

- Windows: code-signing certificate (OV or EV) → GitHub secrets
  `WINDOWS_SIGNING_PFX` / `WINDOWS_SIGNING_PFX_PASSWORD`.
- macOS: Apple Developer Program + Developer ID certificate → secrets
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- Once supplied, implement the signing steps at the gates in
  `desktop-release.yml` (currently the gates fail the build if secrets exist without
  an implemented step — by design).

## 3. Run the real installation acceptance tests (blocking GO)

- Windows: install the built `Murmur-Setup-*.exe` on a clean test machine; record the
  rows in `07-INSTALLATION-TESTS.md` (launch, sign-in, mic, recording, restart, uninstall, upgrade).
- macOS: one Apple Silicon and ideally one Intel Mac; mount DMG, drag-install, launch,
  permissions, recording.
- CI success is packaging evidence only and will never be recorded as install evidence.

## 4. Decide the distribution channel

- Restricted testing now: publish the draft pre-release from the pipeline (dispatch
  with `publish=true`), share with named testers, expect SmartScreen/Gatekeeper friction.
- Public launch: only after 1 + 2 + 3.

## 5. Rotate credentials exposed by the handoff ZIP

The archive included `.env*` and `.git/`. Rotate anything plausibly inside
(`docs/post-audit/05-CREDENTIAL-ROTATION-CHECKLIST.md` already lists the standing
items). Use `scripts/export-source.ps1` for all future handoffs.

## 6. Decide on Linux (low priority)

The AppImage target is configured but has no CI leg; deferred by operator decision.

## 7. After signing works

- Flip the auto-update gate per `06-AUTO-UPDATE.md`, verify one real update flow.
- Consider enabling the publish job's production channel (currently prerelease-only
  by design).
