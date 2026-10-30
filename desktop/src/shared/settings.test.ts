import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, normalize, validatePatch } from "./settings.ts";

test("empty or broken input returns defaults", () => {
  assert.deepEqual(normalize(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalize(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalize("garbage"), DEFAULT_SETTINGS);
  assert.deepEqual(normalize({}), DEFAULT_SETTINGS);
});

test("valid values are kept", () => {
  const s = normalize({
    theme: "dark",
    minimizeToTray: false,
    notifyMeetings: false,
    defaultRecordingType: "site-walk",
    localOnly: true,
    retentionDays: 30,
  });
  assert.deepEqual(s, {
    version: 1,
    theme: "dark",
    minimizeToTray: false,
    notifyMeetings: false,
    defaultRecordingType: "site-walk",
    localOnly: true,
    retentionDays: 30,
  });
});

test("invalid values fall back to defaults, not errors", () => {
  assert.equal(normalize({ theme: "hot pink" }).theme, "system");
  assert.equal(normalize({ retentionDays: 9999 }).retentionDays, 0);
  assert.equal(normalize({ retentionDays: 1.5 }).retentionDays, 0);
  assert.equal(normalize({ defaultRecordingType: "hack" }).defaultRecordingType, "meeting");
  assert.equal(normalize({ localOnly: "yes" }).localOnly, DEFAULT_SETTINGS.localOnly);
  assert.equal(normalize({ minimizeToTray: 1 }).minimizeToTray, DEFAULT_SETTINGS.minimizeToTray);
});

test("unknown setting keys are rejected", () => {
  assert.throws(() => validatePatch({ nope: true }), /Unknown setting/);
  assert.throws(() => validatePatch({ version: 2 }), /Unknown setting/);
});

test("all known keys pass validation", () => {
  const patch = validatePatch({
    theme: "light",
    minimizeToTray: true,
    notifyMeetings: true,
    defaultRecordingType: "interview",
    localOnly: false,
    retentionDays: 7,
  });
  assert.equal(Object.keys(patch).length, 6);
});
