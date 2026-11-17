// Main-process side of the settings store: file layout and atomic writes.
// The pure schema lives in ../shared/settings.ts so both processes can use it.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalize,
  type Settings,
  validatePatch,
} from "../shared/settings.ts";

export function settingsPath(dir: string): string {
  return join(dir, "settings.json");
}

export function loadSettings(dir: string): Settings {
  const file = settingsPath(dir);
  if (!existsSync(file)) return { ...normalize({}) };
  try {
    return normalize(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    // A corrupt file must not break the app; fall back to defaults.
    return { ...normalize({}) };
  }
}

/** Apply a validated patch and write atomically so a crash cannot corrupt the file. */
export function saveSettings(dir: string, patch: Record<string, unknown>): Settings {
  const checked = validatePatch(patch);
  const next = normalize({ ...loadSettings(dir), ...checked });
  const file = settingsPath(dir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, file);
  return next;
}

export function deleteSettingsFile(dir: string): void {
  const file = settingsPath(dir);
  if (existsSync(file)) rmSync(file);
}
