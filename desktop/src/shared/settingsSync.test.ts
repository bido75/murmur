import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import {
  FIELD_MODE_TYPE,
  applyServerPrefs,
  effectiveDefaultType,
  needsServerPush,
  serverPatchFrom,
  serverRowOf,
} from "./settingsSync.ts";

const base: Settings = { ...DEFAULT_SETTINGS };

test("server values win; nulls leave the local value alone", () => {
  const s = applyServerPrefs(base, {
    consent_reminder: false,
    field_mode: true,
    default_template: "interview",
    my_state: "TX",
  });
  assert.equal(s.consentReminder, false);
  assert.equal(s.fieldMode, true);
  assert.equal(s.defaultRecordingType, "interview");
  assert.equal(s.myState, "TX");
  const untouched = applyServerPrefs(base, {
    consent_reminder: null,
    field_mode: null,
    default_template: null,
    my_state: null,
  });
  assert.deepEqual(untouched, base);
  assert.deepEqual(applyServerPrefs(base, null), base);
});

test("field mode overrides the saved default type", () => {
  const s = { ...base, defaultRecordingType: "meeting", fieldMode: true };
  assert.equal(effectiveDefaultType(s), FIELD_MODE_TYPE);
  assert.equal(effectiveDefaultType({ ...s, fieldMode: false }), "meeting");
});

test("toggling field mode never writes default_template", () => {
  const patch = serverPatchFrom({ fieldMode: true });
  assert.deepEqual(patch, { field_mode: true });
  const off = serverPatchFrom({ fieldMode: false });
  assert.deepEqual(off, { field_mode: false });
});

test("a real type change does write default_template", () => {
  const patch = serverPatchFrom({ fieldMode: true, defaultRecordingType: "interview" });
  assert.deepEqual(patch, { field_mode: true, default_template: "interview" });
  assert.deepEqual(serverPatchFrom({ defaultRecordingType: "lecture" }), {
    default_template: "lecture",
  });
});

test("device-only settings never reach the server patch", () => {
  assert.deepEqual(
    serverPatchFrom({ theme: "dark", localOnly: true, retentionDays: 30, minimizeToTray: false }),
    {},
  );
});

test("needsServerPush detects drift on the four account-wide fields", () => {
  const row = serverRowOf(base);
  assert.equal(needsServerPush(base, row), false);
  assert.equal(needsServerPush({ ...base, fieldMode: true }, row), true);
  assert.equal(needsServerPush({ ...base, consentReminder: false }, row), true);
  assert.equal(needsServerPush({ ...base, myState: "NY" }, row), true);
  assert.equal(needsServerPush(base, null), true);
});

test("device-only drift does not trigger a server push", () => {
  const row = serverRowOf(base);
  assert.equal(
    needsServerPush({ ...base, theme: "dark", localOnly: true, retentionDays: 14 }, row),
    false,
  );
});
