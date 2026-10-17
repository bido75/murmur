# Murmur for Wear OS (standalone)

Tap to record on your wrist (keeps going with the screen off); the recording uploads over Wi-Fi or
LTE when you stop, retried by WorkManager until the server has it. Notes and tasks appear in the
Murmur app.

- Linked with a one-time code from the app (Settings → Devices). The watch keeps an upload-only
  token in encrypted storage; it can't read your notes. Unlink it from the app any time.
- Asks how people were told before recording, like the app.

## Build

Android Studio (Koala or newer) → Open → `wear/`. Put your Supabase URL and publishable key in
`gradle.properties` (`murmurServerUrl`, `murmurAnonKey`), then run on a Wear OS 3+ watch or
emulator. Or from the command line with a Gradle install: `gradle :app:assembleDebug`.

## Status

Written but **not built or tested** here (no Android SDK in this environment). Expect small fixes.
