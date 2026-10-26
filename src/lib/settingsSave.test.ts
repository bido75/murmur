import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveDefaultTemplate,
  initSettingsUi,
  reduceSave,
} from './settingsSave.ts';

const base = {
  consentReminder: true,
  defaultTemplate: "meeting" as const,
  fieldMode: false,
  myState: null as string | null,
};

test('field mode overrides the effective default without touching the preference', () => {
  assert.equal(effectiveDefaultTemplate(base), "meeting");
  const field = { ...base, fieldMode: true };
  assert.equal(effectiveDefaultTemplate(field), "site_walk");
  // The preference itself is untouched.
  assert.equal(field.defaultTemplate, "meeting");
});

test('a change shows optimistic state while saving', () => {
  const ui = reduceSave(initSettingsUi(base), {
    type: "change",
    patch: { fieldMode: true },
  });
  assert.equal(ui.settings.fieldMode, true);
  assert.equal(ui.saveState, "saving");
  // The last persisted value is unchanged until the save succeeds.
  assert.equal(ui.saved.fieldMode, false);
});

test('a successful save commits the optimistic value', () => {
  let ui = reduceSave(initSettingsUi(base), {
    type: "change",
    patch: { fieldMode: true },
  });
  ui = reduceSave(ui, { type: "saveOk" });
  assert.equal(ui.saved.fieldMode, true);
  assert.equal(ui.saveState, "saved");
});

test('a failed save rolls the control back to what the server actually has', () => {
  let ui = reduceSave(initSettingsUi(base), {
    type: "change",
    patch: { fieldMode: true },
  });
  ui = reduceSave(ui, { type: "saveFail" });
  // Rolled back: the control shows the persisted value again.
  assert.equal(ui.settings.fieldMode, false);
  assert.equal(ui.saved.fieldMode, false);
  assert.equal(ui.saveState, "error");
});

test('a later change after a failure starts from the rolled-back value', () => {
  let ui = reduceSave(initSettingsUi(base), {
    type: "change",
    patch: { fieldMode: true },
  });
  ui = reduceSave(ui, { type: "saveFail" });
  ui = reduceSave(ui, { type: "change", patch: { consentReminder: false } });
  assert.equal(ui.settings.fieldMode, false, "the failed change did not leak");
  assert.equal(ui.settings.consentReminder, false);
  assert.equal(ui.saveState, "saving");
});