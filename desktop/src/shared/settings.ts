// Durable application settings, stored under userData/settings.json.
// Kept free of Electron imports so the store can be unit-tested directly.
export type Theme = "system" | "light" | "dark";

export type Settings = {
  version: 1;
  theme: Theme;
  minimizeToTray: boolean;
  notifyMeetings: boolean;
  defaultRecordingType: string;
  /** Local Only mode: no audio or transcript ever leaves the machine. */
  localOnly: boolean;
  /** Days to keep finished recordings locally; 0 means keep until the user deletes them. */
  retentionDays: number;
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: "system",
  minimizeToTray: true,
  notifyMeetings: true,
  defaultRecordingType: "meeting",
  localOnly: false,
  retentionDays: 0,
};

const THEMES: Theme[] = ["system", "light", "dark"];
const RECORDING_TYPES = [
  "meeting",
  "lecture",
  "interview",
  "sales-call",
  "phone-call",
  "site-walk",
  "voice-note",
];

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === typeof fallback && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

/** Merge any readable object onto the defaults, keeping only valid values. */
export function normalize(raw: unknown): Settings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    version: 1,
    theme: oneOf(o.theme, THEMES, DEFAULT_SETTINGS.theme),
    minimizeToTray: flag(o.minimizeToTray, DEFAULT_SETTINGS.minimizeToTray),
    notifyMeetings: flag(o.notifyMeetings, DEFAULT_SETTINGS.notifyMeetings),
    defaultRecordingType: text(o.defaultRecordingType, RECORDING_TYPES, DEFAULT_SETTINGS.defaultRecordingType),
    localOnly: flag(o.localOnly, DEFAULT_SETTINGS.localOnly),
    retentionDays: boundedInt(o.retentionDays, 0, 365, DEFAULT_SETTINGS.retentionDays),
  };
}

export function validatePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([
    "theme",
    "minimizeToTray",
    "notifyMeetings",
    "defaultRecordingType",
    "localOnly",
    "retentionDays",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) throw new Error(`Unknown setting: ${k}`);
    out[k] = v;
  }
  // Values are checked by normalize() when the patch is applied; unknown keys fail here.
  return out;
}
