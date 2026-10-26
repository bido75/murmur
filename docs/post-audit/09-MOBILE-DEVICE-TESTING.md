# 09 — Mobile device testing matrix

Status: **BLOCKED (hardware)**. No physical device is attached to this
environment; nothing here may be marked PASS without the run.

## Matrix to execute

| Scenario | Android | iOS |
|---|---|---|
| Mic permission grant / deny | ☐ | ☐ |
| Recording start → indicator + timer + level | ☐ | ☐ |
| Pause / resume / stop | ☐ | ☐ |
| Rotation past 5 min (segment split) | ☐ | ☐ |
| Background the app mid-recording | ☐ (dev build required) | ☐ (dev build required) |
| Kill the app mid-recording → relaunch → recovery | ☐ | ☐ |
| Silence warning does not fire during normal speech | ☐ (threshold retest) | ☐ |
| Playback of the finished recording | ☐ | ☐ |
| Upload over flaky network → retry | ☐ | ☐ |
| Transcription (cloud + on-device where supported) | ☐ | ☐ |
| Notes/tasks appear and persist | ☐ | ☐ |
| Settings change → reload → persisted | ☐ | ☐ |
| Accessibility: TalkBack/VoiceOver over Settings | ☐ | ☐ |
| Offline behavior | ☐ | ☐ |
| 60-minute recording | ☐ | ☐ |

## Build requirements

- Background recording and on-device transcription need a **development build**
  (`npx expo run:android` / `npx expo run:ios`, or `eas build --profile
  development`). Expo Go cannot background-record and does not include
  `whisper.rn`.

## Recording the run

For each cell: device model, OS version, app build (SHA), fixture used, result,
log excerpt, limitations. Any cell that cannot be completed stays BLOCKED with
the reason.