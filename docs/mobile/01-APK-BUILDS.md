# Murmur AI Android APKs — EAS build record

## Build history (newest first)

| # | Profile | Build ID | Commit | What changed | Size / SHA-256 | Download |
|---|---|---|---|---|---|---|
| 5 | preview | cf00d0c-bc35-4534-85a3-e65b9f8ac7a2 | da479b9 | **Full multilingual pass**: searchable language picker, mojibake fix, capability matrix (97/109 verified), experimental tier labels, Ghanaian registry complete | 91.2 MB / d739c8a3dfc095a9e42ec15e5c04530c0ea453bf1ca45aca1c076562676a426 | https://expo.dev/artifacts/eas/cGkGu-KqZfh956OO3eW2VX4IYkTVf3QZ0zEHNnHIwf4.apk |
| 4 | preview | `6a8e16e6-2a14-429d-972e-6cbfe3d9e59c` | `06dab9d` | **UX pass**: labeled `Export` + `More` header (≥48dp targets), grouped action menu (AI tools / Share & export / Send / Attachments / Organize / Delete), export+more walkthrough tips on the recording screen; TipCard role fix included | 91.2 MB / `ed939b84e2caa975a32f3a0a5039a343b9a856a157cda6163fc577c4bc002163` | https://expo.dev/artifacts/eas/Hsc-1W-o7lsZu9pn72z42b_vUW3qRsLbsWkNM0fmET8.apk |
| 3 | preview | `8219652c-1997-493b-91d4-04a280e6cbf5` | `f5ccaf6` | TipCard accessibilityRole fix (dialog role was web-only; crashed Android after login) + static role audit | 91.2 MB / `35ea50281469712e214e42b93377ff1878288d0c5182796ff10473f9a9eb05ff` | https://expo.dev/artifacts/eas/OmI071fAAHsl0ljwdgXq1rQ7-swtXjpDsxr-PZRln18.apk |
| 2 | preview | `ff64106a-ca35-4c4b-a796-a10eea02de3a` | `c0a98b8` | First standalone preview (tunnel-origin env baked in) | 91.2 MB / `ee796e660ba366ad403f342db87e3832030623ca501ea0128f56715b676599f5` | https://expo.dev/artifacts/eas/Rh3dImjygAgkVWfikkwoPQXV4eGFjxZ2DDE2iEFg7t8.apk |
| 1 | development | `d81abffa-3415-4633-8cdc-bc154cf4e12a` | `c0a98b8` | Dev client (Metro debugging only; no embedded bundle by design) | 214.9 MB / `c0da172f25cd64cae665d39a6774a821ae0e6709e52c189f0aac0601d6a7dfbe` | https://expo.dev/artifacts/eas/YWcGTEFHHlp4NpMThws6k834B8LffZpzMvJBmnel6yY.apk |

**Install build #4** for the current UX. Verified inside artifact #4: `com.giscop.murmur`, embedded bundle, `notes.giscop.com` origin only (no LAN/dev IPs), walkthrough text embedded. Regressions all green (app/logic/DB suites, role audit 3/3, typecheck).

Earlier context (kept for the record):

Date: 2026-10-30 · Branch `feature/murmur-desktop-v2` · Source at submission: commit `c0a98b8` (+ the tested 56-file shared-lib quote normalization present in the working tree)

## Builds

> **Naming warning (learned the hard way on 2026-10-30):** the dev-client APK shows
> "Unable to load script … make sure you're running Metro" when launched without
> Metro — that is its designed behavior, not a bug. The **preview** APK is the one
> that runs standalone. The operator installed the dev-client APK first and hit
> exactly this. Verified inside the artifacts afterwards: preview contains
> `assets/index.android.bundle`; the dev client contains none (by design).

| Profile | Build ID | Status | Artifact | Size | SHA-256 | Runs standalone? |
|---|---|---|---|---|---|---|
| **preview** (standalone APK — THE ONE TO INSTALL) | `ff64106a-ca35-4c4b-a796-a10eea02de3a` | FINISHED | https://expo.dev/artifacts/eas/Rh3dImjygAgkVWfikkwoPQXV4eGFjxZ2DDE2iEFg7t8.apk | **91.2 MB** | `ee796e660ba366ad403f342db87e3832030623ca501ea0128f56715b676599f5` | **YES** (`assets/index.android.bundle` verified inside) |
| **development** (dev client — Metro debugging only) | `d81abffa-3415-4633-8cdc-bc154cf4e12a` | FINISHED | https://expo.dev/artifacts/eas/YWcGTEFHHlp4NpMThws6k834B8LffZpzMvJBmnel6yY.apk | **214.9 MB** | `c0da172f25cd64cae665d39a6774a821ae0e6709e52c189f0aac0601d6a7dfbe` | NO — needs `npx expo start` (port 8083) + same Wi-Fi or `adb reverse tcp:8083 tcp:8083` |

- Build pages: https://expo.dev/accounts/vgbewonyo/projects/murmur-notes/builds/ff64106a-ca35-4c4b-a796-a10eea02de3a and …/d81abffa-3415-4633-8cdc-bc154cf4e12a
- Package: **`com.giscop.murmur`** · version 1.0.0 (versionCode auto; set explicitly before Play distribution)
- Signing: EAS-generated keystore (internal distribution; fine for testing, replace before store release)

## Verified APK contents (inspected the actual artifacts)

- `com.giscop.murmur` present in the binary manifest (UTF-16) ✓
- `android.permission.RECORD_AUDIO` declared ✓
- JS bundle embeds `https://notes.giscop.com` as the backend origin ✓
- **No `localhost`/LAN URLs in the bundle** (127.0.0.1:54321 and :8090 absent) ✓
- Public values only: `EXPO_PUBLIC_*` (anon key is the publishable key); no service-role/SMTP secrets (checked)

## Build fixes made during this run

1. First development build (`d447a5d7`) failed: `modules/murmur-foreground` Kotlin — bare
   `return@Function` conflicted with expo-modules-core Function typing.
   Fixed in commit `c0a98b8` (the module implements the Android-14-compliant
   foreground recording service). Both re-submitted builds then passed, confirming the fix.
2. `eas.json` env carries the public values explicitly: EAS uploads respect
   `.gitignore`, so the gitignored `.env` (which holds localhost values) never reaches
   the cloud builder — the APK was intentionally pointed at `https://notes.giscop.com`
   for Supabase (auth/rest/storage/functions/realtime are all routed through the
   tunnel, verified live) and for the app origin.

## Installation instructions (operator)

1. **Uninstall any previously installed Murmur first** (both APKs share the package `com.giscop.murmur`).
2. Copy `Murmur-preview-0.1.0.apk` to the phone (or open the preview artifact link on the phone).
3. Allow "Install unknown apps" for the source when prompted (normal for sideloading).
4. Install → open **Murmur** → sign in (OTP email) → allow the microphone prompt → record.
5. The dev-client APK (`Murmur-devclient-…`) is for Metro debugging only: `npx expo start` (port **8083**), then open the dev client from the same Wi-Fi or with `adb reverse tcp:8083 tcp:8083`.

## Corrected build (2026-10-30 later) — the accessibility-role crash

The first preview APK crashed right after login on Android: the onboarding TipCard
passed `accessibilityRole="dialog"`, which React Native's Android view manager rejects
(web-only ARIA role). Fixed in commit `f5ccaf6` — web keeps the ARIA dialog role,
native relies on `accessible` + label + live region — plus a static audit test
(`src/lib/accessibilityRoles.test.ts`, scans every role literal in the app against
RN's Android role set, 3 tests). Full repo regression: typecheck clean, suite green.

| Corrected preview build | |
|---|---|
| Build ID | `8219652c-1997-493b-91d4-04a280e6cbf5` (FINISHED) |
| Download | https://expo.dev/artifacts/eas/OmI071fAAHsl0ljwdgXq1rQ7-swtXjpDsxr-PZRln18.apk |
| Size / SHA-256 | 91.2 MB / `35ea50281469712e214e42b93377ff1878288d0c5182796ff10473f9a9eb05ff` |
| Contents verified | package `com.giscop.murmur`, embedded bundle, `notes.giscop.com` origin, no LAN URLs |

Install over the old one or uninstall first. The dev client picks the fix up instantly
via Metro (reload the app).

## Known limitations (honest)

- **No real-device test has been run yet** — launch, sign-in, mic prompt, 30s/5m/15m
  recording, backgrounding, screen lock, network loss, restart, and upload-retry rows
  are all **PENDING-USER** (the 15-row checklist in the APK task).
- Background/locked-screen recording depends on the `murmur-foreground` service
  working under Android's foreground-service mic rules (Android 14+ requires starting
  it while foregrounded) — to be verified on device, not promised.
- Internal distribution signing; not Play-Store ready; no auto-update on Android yet.
