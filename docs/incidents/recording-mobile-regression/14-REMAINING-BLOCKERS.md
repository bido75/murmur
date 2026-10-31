# Remaining blockers

| # | Blocker | Owner | Unblocks |
|---|---|---|---|
| 1 | Confirm recording on a real device (Android Chrome + one desktop browser): reload, prompt, 30s recording, save, transcript | operator | Closes Failure A fully |
| 2 | ~~`eas-cli login`~~ **DONE 2026-10-30** (account `vgbewonyo`, project `c0a97185` linked) | — | — |
| 3 | ~~Approve Android package `com.giscop.murmur`~~ **ADOPTED** (no prior signing history; both APKs built) | — | — |
| 4 | Android hardware tests: install the built preview APK, then 30s/5m/15m recordings, backgrounding, screen lock, network loss, restart, retry | operator + device | Native recording readiness — APKs are built and waiting: see `docs/mobile/01-APK-BUILDS.md` |
| 5 | Rotating the exposed credential sets (incl. anything in the leaked ZIP) | operator | Standing F-09 / P0 release gate |
| 6 | `SMTP_PASSWORD` sharing `.env` with Expo-loaded vars | developer (cosmetic, next pass) | hygiene |
| 7 | In-app-browser mic caveats documented (webviews may withhold mic by policy) | developer (docs) | expectations |

Incident status: **PARTIALLY RESOLVED** — web root cause fixed, deployed and verified
at the header level; Android APKs (preview + dev client) are built and downloadable;
device-level confirmation remains operator-gated (items 1 and 4).
