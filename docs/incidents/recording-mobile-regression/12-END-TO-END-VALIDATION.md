# End-to-end validation matrix

Legend: PASS = executed with evidence; PENDING-USER = ready, needs the operator's
click/device; BLOCKED = cannot be executed here.

## Web (fix deployed live)

| Environment | Launch/login | Permission prompt | Record | Save | Transcribe |
|---|---|---|---|---|---|
| Android Chrome via HTTPS | PENDING-USER | expected now (was auto-denied) | PENDING-USER | PENDING-USER | known-good backend |
| Android in-app browser | UNSUPPORTED guidance — in-app browsers (e.g. some social-app webviews) may withhold mic; use Chrome | — | — | — | — |
| Desktop Chrome via HTTPS | PENDING-USER | expected | PENDING-USER | PENDING-USER | known-good backend |
| Desktop Edge via HTTPS | PENDING-USER | expected | PENDING-USER | PENDING-USER | known-good backend |
| iOS Safari | UNTESTED — no iOS device | — | — | — | — |

Header-level verification (executable, done): `permissions-policy` shows
`microphone=(self)` on `https://notes.giscop.com` — the auto-denial mechanism is gone.

## Native (Expo/dev build)

| Environment | Status |
|---|---|
| Expo Go on Android | DIAGNOSED — SDK-58 compatibility; superseded by dev builds |
| Expo development build | STAGED — blocked on `eas-cli login` |
| Preview APK | STAGED — blocked on `eas-cli login`; then the 15-row hardware checklist from the APK prompt |

## Electron desktop

Regression suite: tsc clean, **160/0** unit tests, boot smoke — green on the same day.
Recording on desktop is unaffected (native APIs; no web headers involved).
