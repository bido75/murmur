# Native mobile recording (Expo/React Native)

Not rewritten — audited for the incident.

| Requirement | Status | Evidence |
|---|---|---|
| Native microphone APIs (not getUserMedia) | PASS — `expo-audio` native recording | `src/lib/recorder.ts`, `src/lib/mic.ts` (expo-audio `requestRecordingPermissionsAsync`) |
| Android RECORD_AUDIO declaration | to be emitted by prebuild from app.json plugins/permissions | `app.json`; verified at build time (BLOCKED until first EAS build) |
| Runtime permission request + denial handling | implemented | `mic.ts` requestMic with denial paths |
| Foreground/background behavior | ACCURATELY DOCUMENTED as limited — the app already records with segments + recovery; uninterrupted screen-locked recording needs the foreground-service question answered on device, not promised here | `docs` release verification BL-10 residual |
| Upload queue + retry | implemented and tested | `src/lib/sync.ts` + tests |
| Browser/Electron separation | no getUserMedia in native path; Electron modules isolated under `desktop/` | repo layout + boundary checks in `NODE-TEST-RESOLUTION-REMEDIATION.md` |

Real-device rows remain BLOCKED until the preview APK is built and installed (single
dependency: the operator's `eas-cli login`).
