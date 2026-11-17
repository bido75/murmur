import { test } from "node:test";
import assert from "node:assert/strict";
import { micFailureMessage, micHint, type MicDeviceInfo } from "./micFailure.ts";

const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

test("NotFoundError without a device probe gives OS privacy guidance", () => {
  const msg = micFailureMessage("NotFoundError", "", null, WINDOWS);
  assert.match(msg, /No microphone was found/);
  assert.match(msg, /Windows Settings → Privacy → Microphone/);
});

test("NotFoundError in a Remote Desktop session names the RDP fix", () => {
  const d: MicDeviceInfo = { audioInputs: 0, hasCamera: true, remoteOnly: true };
  const msg = micFailureMessage("NotFoundError", "", d, WINDOWS);
  assert.match(msg, /Remote Desktop/);
  assert.match(msg, /Record from this computer/);
});

test("NotFoundError with a camera but no mic says the camera may be camera-only", () => {
  const d: MicDeviceInfo = { audioInputs: 0, hasCamera: true, remoteOnly: false };
  const msg = micFailureMessage("NotFoundError", "", d, WINDOWS);
  assert.match(msg, /camera was detected/);
  assert.match(msg, /no microphone/);
});

test("NotAllowedError and SecurityError are told apart as permission problems", () => {
  for (const name of ["NotAllowedError", "SecurityError"]) {
    const msg = micFailureMessage(name, "", null, WINDOWS);
    assert.match(msg, /Microphone access is off/, name);
  }
});

test("NotReadableError and TrackStartError are a busy device", () => {
  for (const name of ["NotReadableError", "TrackStartError"]) {
    assert.match(micFailureMessage(name, "", null, WINDOWS), /busy|another app/i, name);
  }
});

test("OverconstrainedError and AbortError keep their distinct wording", () => {
  assert.match(micFailureMessage("OverconstrainedError", "", null, WINDOWS), /requested settings/);
  assert.match(micFailureMessage("AbortError", "", null, WINDOWS), /cancelled/);
});

test("an unknown error still carries the underlying detail, truncated", () => {
  const detail = "x".repeat(300);
  const msg = micFailureMessage("SomeRandomError", detail, null, WINDOWS);
  assert.match(msg, /Couldn't open the microphone/);
  assert.ok(!msg.includes("x".repeat(200)), "detail is capped");
});

test("micHint names the right platform for privacy guidance", () => {
  assert.match(micHint(null, WINDOWS), /Windows Settings/);
  assert.match(micHint(null, MAC), /System Settings/);
  assert.match(micHint(null, "Linux"), /operating system/);
});

test("a camera-only device hint asks the user to check the webcam mic in Windows", () => {
  const d: MicDeviceInfo = { audioInputs: 0, hasCamera: true, remoteOnly: false };
  assert.match(micHint(d, WINDOWS), /Settings → System → Sound → Input/);
});