// Static guard for the 2026-10-30 Android crash: TipCard passed
// accessibilityRole="dialog" and the native view manager threw
// "Invalid accessibility role value: dialog", killing the app right after login.
//
// This test walks every component source file and fails if any static
// accessibilityRole literal is outside React Native's supported set, so a web-only
// ARIA role can never reach the Android runtime again.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/** The roles React Native's Android AccessibilityRole enum accepts (0.88). */
const RN_ANDROID_ROLES = new Set([
  "none",
  "button",
  "link",
  "search",
  "image",
  "keyboardkey",
  "text",
  "adjustable",
  "imagebutton",
  "header",
  "summary",
  "alert",
  "checkbox",
  "combobox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "progressbar",
  "radio",
  "radiogroup",
  "scrollbar",
  "spinbutton",
  "switch",
  "tab",
  "tablist",
  "tabpanel",
  "pager",
  "scrollview",
  "wheel",
  "drawerlayout",
  "slidingdrawer",
]);

const ROOT = join(import.meta.dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test("every static accessibilityRole in app code is valid on Android", () => {
  const offenders = [];
  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/accessibilityRole="([^"]+)"/g)) {
      if (!RN_ANDROID_ROLES.has(m[1]))
        offenders.push(`${file.replace(ROOT + "\\", "")}: "${m[1]}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("known web-only roles are caught if they ever come back", () => {
  // Guards against a silent widening of the supported set above.
  assert.equal(RN_ANDROID_ROLES.has("dialog"), false);
  assert.equal(RN_ANDROID_ROLES.has("alertdialog"), false);
  assert.equal(RN_ANDROID_ROLES.has("status"), false);
});

test("the platform split in TipCard is web-only for the dialog role", () => {
  const tip = readFileSync(join(ROOT, "src", "components", "tour", "TipCard.tsx"), "utf8");
  assert.match(tip, /Platform\.OS === "web" \? "dialog" : undefined/);
  // And no bare dialog literal remains anywhere in the component.
  assert.doesNotMatch(tip, /accessibilityRole="dialog"/);
});
