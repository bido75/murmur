# Murmur for Apple Watch (standalone)

Tap to record on your wrist; the recording uploads over Wi-Fi or cellular when you stop (and is
kept on the watch until the upload succeeds). Notes and tasks appear in the Murmur app.

- Linked with a one-time code from the app (Settings → Devices). The watch gets an upload-only
  token kept in the Keychain; it can't read your notes. Unlink it from the app any time.
- Asks how people were told before recording, like the app.

## Build

Requires a Mac with Xcode 15+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
cd watch
xcodegen
open MurmurWatch.xcodeproj
```

Set `MURMUR_SERVER_URL` (your Supabase URL) and `MURMUR_ANON_KEY` (the publishable key) in the
target's build settings, choose your team under Signing, and run on a watch or simulator.

## Status

Written but **not built or tested** (no Mac in this environment). Expect small compile fixes.
Not handled yet: recording in the background for very long sessions (watchOS may end the session
when the screen sleeps unless the audio background mode is granted), and complications.
