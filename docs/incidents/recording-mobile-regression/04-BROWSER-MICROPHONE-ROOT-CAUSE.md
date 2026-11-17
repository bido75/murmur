# Browser microphone root cause

## Confirmed root cause (Failure A)

`serve-web-dist.cjs` sent `Permissions-Policy: microphone=()`. Browsers enforce
Permissions-Policy **before** the permission prompt: `getUserMedia()` rejects with
`NotAllowedError` and the app shows "The browser is not allowed to use the
microphone." This is exactly the operator's Android report.

- Introduced: security hardening `2065aac` (2026-10-29) — the whitehat pass
  recommended a restrictive Permissions-Policy; "restrict everything" was copied
  without noticing that microphone recording **is** this product.
- Why login still worked: the header only gates sensitive features, not fetch/auth.
- Why the desktop app was unaffected: Electron records via native APIs and its own
  permission handler (`main.ts`), not the web server's headers.

## Classification note

The app's existing error message ("browser is not allowed to use the microphone")
was **accurate** for this failure — no misclassification. The diagnostic
instrumentation requested in the incident prompt is still worth adding
(error-name-specific messages), but was not required to find this root cause; the
header was observable without touching the client.

## The fix (deployed 2026-10-30)

- `scripts/securityHeaders.cjs` (new): single source for all security headers,
  `microphone=(self)` — same-origin only, the narrowest policy that permits the
  product's purpose. camera/payment remain `()`; geolocation stays `(self)`.
- `scripts/serve-web-dist.cjs` consumes it.
- `scripts/securityHeaders.test.mjs` (new): pins `microphone=(self)`, forbids
  `microphone=()`, and keeps the other headers — the regression test requested.

## Remaining verification (honest status)

- Header fix verified live through the tunnel (browser-visible). ✓
- **Actual device recording (Android Chrome) — BLOCKED for the developer; the
  operator performs the click test.** If it still fails on device, the next
  diagnostic step is the sanitized console log of the exact DOMException, but the
  header was the only deny mechanism present.
