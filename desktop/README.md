# Murmur for Mac and Windows

A small desktop recorder for online meetings. It records your mic plus the computer's own sound
(the other people on Zoom, Teams, Meet, Webex), so **no bot joins the call**. Recordings go into
the same account and get the same notes and tasks as the phone app.

## How it works

- **Mic + system audio** are mixed and saved as WebM/Opus (64 kbps, ~0.5 MB a minute).
  - **Windows**: Chromium's loopback capture (built into Electron).
  - **macOS 13+**: a tiny Swift helper (`native/macos`) uses ScreenCaptureKit to capture system
    audio (excluding Murmur itself) and streams it to the app.
- **Crash-safe**: audio is appended to disk every 4 seconds and split into 5-minute parts. If the
  app or computer crashes, reopening it recovers the recording. A part cut off mid-write still
  plays up to the last few seconds (tested).
- **Offline**: parts wait in a local queue and upload with retry when the network is back.
- **Meeting detection**: every 15 seconds it checks for Zoom/Teams/Webex meetings and offers to
  record (a notification). Closing the window keeps recording in the tray.
- **Security**: sandboxed renderer, context isolation, no Node in the page, a fixed list of IPC
  channels, and file access limited to the app's own data folder.

## Build

Needs Node 20+. Uses the same `.env` as the phone app (`EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_URL`).

```bash
cd desktop
npm install
npm start              # build and run
npm run typecheck && npm test
```

### macOS

```bash
npm run mac-helper     # compile the ScreenCaptureKit helper (needs Xcode command line tools)
npm run dist:mac       # .dmg in release/
```

For other people to open it, sign and notarize: set `CSC_LINK`/`CSC_KEY_PASSWORD` (Developer ID
Application certificate) and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, then run
`dist:mac`. On first record macOS asks for **Microphone** and **Screen & System Audio Recording**
permission; after granting the second one, quit and reopen Murmur.

### Windows

```bash
npm run dist:win       # installer in release/
```

Sign with an EV/OV code-signing certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`) or SmartScreen will
warn users.

## Tested here vs. needs a real machine

Tested (Linux, headless Electron): build, typecheck, queue and meeting-detection logic, sign-in
screen renders, the page can't reach Node, a 6-second recording is written to disk during
recording, is valid WebM, decodes, and still decodes when cut off.

**Not yet tested** (no Mac or Windows here): the Swift helper, Windows loopback audio, tray,
notifications, installers and signing. Please run this checklist:

- [ ] Mac: `npm run mac-helper`, `npm start`, grant both permissions, record a YouTube video plus
      your voice for 1 minute. Notes should have both.
- [ ] Windows: same test. Both voices should be in the transcript.
- [ ] Join a Zoom or Teams call: the "meeting detected" notification appears within ~15 s.
- [ ] Record for 12 minutes: "parts saved" reaches 2, notes cover the whole meeting.
- [ ] Start recording, wait 6 minutes, kill the app in Task Manager / Activity Monitor. Reopen:
      the recording is recovered and processed.
- [ ] Record with Wi-Fi off, stop, turn Wi-Fi on: it uploads.
- [ ] Close the window while recording: it keeps recording (tray icon is red); Stop from the tray.
- [ ] Install the signed .dmg / .exe on a second computer with no developer tools.

## Known limits

- System audio on macOS needs 13 (Ventura) or newer; older Macs record the mic only.
- Speaker labels come from the audio, so with system audio mixed in, remote people are told apart
  by voice, not by Zoom/Teams names.
- Meeting detection for Meet (browser tabs) isn't automatic; use the Record button.
- Headphones are fine on both platforms because system audio is captured directly.
