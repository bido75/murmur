# Expo Go connectivity (Failure B)

## Diagnosis

- Project: Expo **SDK 58** (expo ~58.0.21), react-native 0.88 (aligned to 0.88.1 during
  this investigation), expo-doctor **20/20** after alignment.
- Expo Go (the Play Store app) runs exactly one SDK version at a time. If the
  installed Expo Go is not the SDK-58 build, opening the project fails before any
  bundle loads — which matches "cannot access through Expo Go" with no captured error.
- The production tunnel (`notes.giscop.com`) is irrelevant to Expo Go: it serves the
  static web app, not Metro. Nothing in the desktop work changed Metro or Expo
  configuration; Metro starts (`npx expo start`, port 8083 pinned in package.json).

## Resolution path (per Expo's supported workflow and the operator's own prompt)

Expo Go compatibility is **no longer the goal**; the project moves to development
builds, which also deliver the standalone APK:

1. `npx eas-cli login` (operator; interactive) — or `EXPO_TOKEN=…` for non-interactive.
2. `npx eas-cli build --platform android --profile development --non-interactive` →
   installable dev-client APK (connects to Metro for debugging).
3. `npx eas-cli build --platform android --profile preview --non-interactive` →
   standalone APK (launches without Expo Go, no Metro) — the real-device test target.

## Verified during this investigation

- `eas.json` created (development = dev-client APK; preview = standalone APK with
  `EXPO_PUBLIC_APP_ORIGIN=https://notes.giscop.com`; production = AAB later).
- Android package set to `com.giscop.murmur` (proposed by the operator's prompt; no
  prior package id or signing history existed — the old value was the placeholder
  `com.example.murmur`).
- `eas-cli 27.2.0` installed and functional; auth state: **Not logged in** — the exact
  operator gate for every EAS step above.
- Native recording already uses `expo-audio` (native module) — it works in dev
  builds/preview APKs; parts of it are unsupported in Expo Go by nature, which is a
  further reason the dev-build path is correct rather than a regression to fix.
