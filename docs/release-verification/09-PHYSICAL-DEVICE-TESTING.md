# 09 — Physical device testing

Status: **BLOCKED (hardware)** — no physical device is attached to this
environment. No emulator-only results are offered as a substitute.

The executable manual test plan remains `docs/post-audit/09-MOBILE-DEVICE-TESTING.md`
(matrix of model/OS/build × scenario with pass/fail columns). What this sprint
added for the device phase:

1. **The recovery path the device tests will exercise is now integration-proven**
   (`05-RECORDING-CRASH-RECOVERY.md`): force-kill the app mid-recording on
   device, relaunch, and the tests' exact scenarios (readable part, corrupt
   part, missing part, double recovery, offline queue, failed upload retry) are
   the ones to tick off — with expected outcomes now written down.
2. **The sweep** (`fail_stale_processing`) gives device testers a deterministic
   answer for "what if processing never finishes" instead of an indefinite
   spinner.
3. The transcript cap changes nothing observable for normal recordings (under
   120K chars) — device testers should confirm a normal 1-hour meeting still
   produces full notes (it will; the cap only guards extreme transcripts).

What the device matrix still must cover (unchanged, hardware-bound):
microphone permissions flow, start/stop/pause/resume, background interruption
and system mic preemption warnings, actual process-kill recovery, playback,
upload on flaky networks, on-device transcription (dev build), settings
persistence, screen-reader/keyboard accessibility on real OS layers.

Owner: operator + device. The release stays CONDITIONAL with this gate open.
