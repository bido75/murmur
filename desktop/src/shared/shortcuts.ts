// Keyboard shortcuts for dictation.
//
// The rules are here, away from Electron, so they can be tested: how a key is
// described, how two descriptions are compared, and which one wins when two actions
// want the same keys.

/** The actions a shortcut can start. */
export type ShortcutAction =
  | "record" // start and stop a dictation
  | "cancel" // stop and throw away
  | "pasteLast" // put the last dictation back on the clipboard
  | "history"; // open the dictation history

/** How the shortcut behaves. */
export type ActivationMode = "pushToTalk" | "toggle";

export type Shortcut = {
  action: ShortcutAction;
  /** The keys, written the way a person would say them: "ctrl+shift+space". */
  binding: string;
  mode: ActivationMode;
};

/** The keys the app understands, in the order they are written. */
const MODIFIERS = ["win", "ctrl", "alt", "shift"] as const;

/** A key name that is not a modifier. */
const NAMED_KEYS = new Set([
  "space",
  "enter",
  "escape",
  "tab",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  "pause",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
]);

/**
 * Put a binding into its one true form.
 *
 * The modifiers always come first and in the same order, and the rest are in
 * alphabetical order. So "shift+ctrl+a" and "ctrl+shift+a" are the same shortcut,
 * and only one of them can be held at a time.
 */
export function normalizeBinding(binding: string): string {
  const parts = binding
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const modifiers = parts.filter((p) =>
    (MODIFIERS as readonly string[]).includes(p),
  );
  const rest = parts
    .filter((p) => !(MODIFIERS as readonly string[]).includes(p))
    .sort();
  return [...modifiers.sort(byModifierOrder), ...rest].join("+");
}

function byModifierOrder(a: string, b: string): number {
  const ia = MODIFIERS.indexOf(a as (typeof MODIFIERS)[number]);
  const ib = MODIFIERS.indexOf(b as (typeof MODIFIERS)[number]);
  return ia - ib;
}

/**
 * Check that a binding is one the app can use.
 *
 * A binding needs at least one key, and the key has to be one that can be pressed.
 */
export function validateBinding(binding: string): {
  ok: boolean;
  reason?: string;
} {
  const normalized = normalizeBinding(binding);
  if (!normalized) return { ok: false, reason: "Choose some keys." };
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (!modifiers.length)
    return {
      ok: false,
      reason: "Add a modifier such as Ctrl or Alt, so the shortcut does not clash with typing.",
    };
  const named = NAMED_KEYS.has(key);
  const single = /^[a-z0-9]$/.test(key);
  const functionKey = /^f([1-9]|1[0-2])$/.test(key);
  if (!named && !single && !functionKey)
    return { ok: false, reason: `${key} is not a key that can be used.` };
  return { ok: true };
}

/** The shortcuts the app starts with. */
export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { action: "record", binding: "ctrl+space", mode: "pushToTalk" },
  { action: "cancel", binding: "ctrl+backspace", mode: "toggle" },
  { action: "pasteLast", binding: "ctrl+shift+space", mode: "toggle" },
];

/**
 * Find the shortcut that clashes with this one.
 *
 * The same keys cannot start two things, so the second one is refused.
 */
export function findConflict(
  binding: string,
  existing: Shortcut[],
): Shortcut | null {
  const wanted = normalizeBinding(binding);
  if (!wanted) return null;
  return (
    existing.find((s) => normalizeBinding(s.binding) === wanted) ?? null
  );
}

/**
 * The shortcuts that can be used, once the ones already taken are removed.
 *
 * A shortcut that is being changed does not clash with itself.
 */
export function withoutConflicts(
  shortcuts: Shortcut[],
  changed?: ShortcutAction,
): Shortcut[] {
  const taken = shortcuts.filter((s) => s.action !== changed);
  const used = new Set<string>();
  const out: Shortcut[] = [];
  for (const s of shortcuts) {
    const key = normalizeBinding(s.binding);
    if (s.action === changed || !used.has(key)) {
      used.add(key);
      out.push(s);
    }
  }
  void taken;
  return out;
}

/**
 * The keys Electron needs to register a global shortcut.
 *
 * Electron wants the modifier names and the key separately, and it spells the named
 * keys differently from the way a person writes them.
 */
export function toElectronAccelerator(binding: string): string | null {
  const normalized = normalizeBinding(binding);
  if (!normalized) return null;
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  const names: Record<string, string> = {
    win: "Super",
    ctrl: "CommandOrControl",
    alt: "Alt",
    shift: "Shift",
  };
  // The named keys, as Electron spells them.
  const named: Record<string, string> = {
    space: "Space",
    enter: "Return",
    escape: "Escape",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    pause: "Pause",
  };
  const prefix = modifiers.map((m) => names[m]).join("+");
  const keyName = named[key] ?? (/^f\d+$/.test(key) ? key.toUpperCase() : key.toUpperCase());
  return prefix ? `${prefix}+${keyName}` : keyName;
}

/** The words for an action, for the settings screen. */
export const ACTION_LABELS: Record<ShortcutAction, string> = {
  record: "Start and stop dictating",
  cancel: "Cancel dictating",
  pasteLast: "Put the last dictation on the clipboard",
  history: "Open the dictation history",
};
