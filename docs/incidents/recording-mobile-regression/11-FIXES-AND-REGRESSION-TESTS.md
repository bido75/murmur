# Fixes and regression tests

## Fix 1 (root cause A): Permissions-Policy microphone

- **Root cause addressed**: server sent `Permissions-Policy: microphone=()`, so the
  browser rejected `getUserMedia` with `NotAllowedError` before the permission prompt.
- **Why it failed**: the 2026-10-29 hardening pass copied a scanner-recommended
  deny-all permission policy without excluding the app's core capability.
- **Files changed**: `scripts/serve-web-dist.cjs` (consume shared builder),
  `scripts/securityHeaders.cjs` (new), `scripts/securityHeaders.test.mjs` (new, 4 tests).
- **Why safe**: one directive changed from deny-all to same-origin-only; camera/payment
  stay denied; HSTS/nosniff/frame/Referrer/CSP untouched; no client code changed.
- **Regression tests**: `securityHeaders.test.mjs` — pins `microphone=(self)`, forbids
  `microphone=()`, keeps the other headers. Wired into repo test runs (scripts dir).
- **Platforms affected**: hosted web + mobile browsers only (desktop unaffected).
- **Rollback plan**: revert the two files; header returns to previous value (but that
  restores the bug — rollback is for safety, not desirability).

## Fix 2 (prevention): installer test-file hygiene

- `electron-builder.yml` excludes vendored `global-agent` test files — not part of this
  incident; committed earlier the same day (`70859b0`).

## Mobile/EAS staging (not a fix — unblocks native testing)

- `eas.json` (development/preview APK, production AAB; `EXPO_PUBLIC_APP_ORIGIN` set for
  preview/production), `app.json` android package `com.giscop.murmur`,
  react-native aligned 0.88.0 → 0.88.1 (expo install). No recording logic touched.
