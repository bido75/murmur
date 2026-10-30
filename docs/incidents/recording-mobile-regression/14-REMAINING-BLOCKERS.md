# Remaining blockers

| # | Blocker | Owner | Unblocks |
|---|---|---|---|
| 1 | Confirm recording on a real device (Android Chrome + one desktop browser): reload, prompt, 30s recording, save, transcript | operator | Closes Failure A fully |
| 2 | `npx eas-cli login` (Expo account) | operator | Development build, preview APK, Expo Go replacement — Failure B + the APK task |
| 3 | Approve Android package `com.giscop.murmur` (proposed in your prompt; no prior signing history exists) | operator | EAS build can proceed under the final identity |
| 4 | Android hardware tests: 30s/5m/15m recordings, backgrounding, screen lock, network loss, restart, retry | operator + device | Native recording readiness |
| 5 | Rotating the exposed credential sets (incl. anything in the leaked ZIP) | operator | Standing F-09 / P0 release gate |
| 6 | `SMTP_PASSWORD` sharing `.env` with Expo-loaded vars | developer (cosmetic, next pass) | hygiene |
| 7 | In-app-browser mic caveats documented (webviews may withhold mic by policy) | developer (docs) | expectations |

Incident status: **PARTIALLY RESOLVED** — web root cause fixed, deployed and verified
at the header level; device-level confirmation and the native/EAS track are operator-
gated (items 1–4).
