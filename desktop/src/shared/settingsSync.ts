// How the desktop's local settings meet the account-wide user_settings row.
//
// Contract (docs/DESKTOP_INTEGRATION_HANDOFF.md):
//  - consent_reminder, field_mode, default_template and my_state live on the server;
//    a preference set on the phone shows on the desktop and the other way round.
//  - field_mode is an override; default_template is the saved preference. Toggling
//    field mode must never write default_template.
//  - localOnly stays on this device on purpose: privacy choices are not account data.

import type { Settings } from "./settings";

export type ServerPrefs = {
  consent_reminder: boolean | null;
  field_mode: boolean | null;
  default_template: string | null;
  my_state: string | null;
};

export const FIELD_MODE_TYPE = "site_walk";

/** Server values win when they exist; nulls leave the local value alone. */
export function applyServerPrefs(base: Settings, server: Partial<ServerPrefs> | null): Settings {
  if (!server) return base;
  return {
    ...base,
    consentReminder: server.consent_reminder ?? base.consentReminder,
    fieldMode: server.field_mode ?? base.fieldMode,
    defaultRecordingType: server.default_template ?? base.defaultRecordingType,
    myState: server.my_state ?? base.myState,
  };
}

/** The recording type the user actually gets: field mode overrides the saved one. */
export function effectiveDefaultType(s: Settings): string {
  return s.fieldMode ? FIELD_MODE_TYPE : s.defaultRecordingType;
}

const SERVER_FIELDS: Record<string, string> = {
  consentReminder: "consent_reminder",
  fieldMode: "field_mode",
  defaultRecordingType: "default_template",
  myState: "my_state",
};

/**
 * Which server columns a local patch should update.
 *
 * The field-mode rule is enforced here, not left to the caller: default_template is
 * written only when the patch actually carries a new default type, so a bare
 * field-mode toggle updates the override flag while leaving the user's saved
 * preference untouched.
 */
export function serverPatchFrom(patch: Record<string, unknown>): Partial<ServerPrefs> {
  const out: Partial<ServerPrefs> = {};
  for (const [localKey, serverKey] of Object.entries(SERVER_FIELDS)) {
    if (!(localKey in patch)) continue;
    (out as Record<string, unknown>)[serverKey] = patch[localKey];
  }
  return out;
}

/** Whether the four account-wide fields differ from what was last pushed. */
export function needsServerPush(current: Settings, lastSynced: Partial<ServerPrefs> | null): boolean {
  if (!lastSynced) return true;
  return (
    lastSynced.consent_reminder !== current.consentReminder ||
    lastSynced.field_mode !== current.fieldMode ||
    lastSynced.default_template !== current.defaultRecordingType ||
    lastSynced.my_state !== current.myState
  );
}

export function serverRowOf(s: Settings): ServerPrefs {
  return {
    consent_reminder: s.consentReminder,
    field_mode: s.fieldMode,
    default_template: s.defaultRecordingType,
    my_state: s.myState,
  };
}
