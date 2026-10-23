import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_LABELS,
  DEFAULT_SHORTCUTS,
  findConflict,
  normalizeBinding,
  toElectronAccelerator,
  validateBinding,
  withoutConflicts,
} from './shortcuts.ts';

test('a binding is put into one true form', () => {
  assert.equal(normalizeBinding('Ctrl+Shift+A'), 'ctrl+shift+a');
  assert.equal(normalizeBinding('shift+ctrl+a'), 'ctrl+shift+a');
  assert.equal(normalizeBinding('  ctrl +  space '), 'ctrl+space');
  assert.equal(normalizeBinding('ctrl+shift+space'), 'ctrl+shift+space');
  assert.equal(normalizeBinding(''), '');
});

test('a binding needs a modifier and a real key', () => {
  assert.equal(validateBinding('ctrl+space').ok, true);
  assert.equal(validateBinding('ctrl+a').ok, true);
  assert.equal(validateBinding('ctrl+f12').ok, true);
  assert.equal(validateBinding('').ok, false);
  assert.equal(validateBinding('space').ok, false, 'a lone key would clash with typing');
  assert.match(validateBinding('space').reason ?? '', /modifier/);
  assert.equal(validateBinding('ctrl+').ok, false);
});

test('the same keys cannot start two things', () => {
  const shortcuts = DEFAULT_SHORTCUTS;
  const clash = findConflict('ctrl+shift+space', shortcuts);
  assert.ok(clash, 'the same keys in another order still clash');
  assert.equal(clash?.action, 'pasteLast');
  assert.equal(findConflict('ctrl+alt+q', shortcuts), null);
});

test('the shortcuts that can be used leave out the ones already taken', () => {
  const shortcuts = DEFAULT_SHORTCUTS;
  const kept = withoutConflicts(shortcuts);
  assert.equal(kept.length, shortcuts.length, 'the defaults do not clash with each other');

  const clashing = [
    { action: "record" as const, binding: "ctrl+space", mode: "pushToTalk" as const },
    { action: "cancel" as const, binding: "ctrl+space", mode: "toggle" as const },
  ];
  assert.equal(withoutConflicts(clashing).length, 1, 'one of the two is dropped');
});

test('a shortcut that is being changed does not clash with itself', () => {
  const shortcuts = DEFAULT_SHORTCUTS;
  const kept = withoutConflicts(shortcuts, "record");
  assert.equal(kept.length, shortcuts.length);
  assert.equal(findConflict("ctrl+space", shortcuts.filter((s) => s.action !== "record")), null);
});

test('the accelerator Electron needs is put together properly', () => {
  assert.equal(toElectronAccelerator('ctrl+space'), 'CommandOrControl+Space');
  assert.equal(toElectronAccelerator('ctrl+shift+a'), 'CommandOrControl+Shift+A');
  assert.equal(toElectronAccelerator('alt+win+f4'), 'Super+Alt+F4');
  assert.equal(toElectronAccelerator('ctrl+backspace'), 'CommandOrControl+Backspace');
  assert.equal(toElectronAccelerator(''), null);
});

test('every action has words for the user', () => {
  for (const s of DEFAULT_SHORTCUTS)
    assert.ok(ACTION_LABELS[s.action].length > 5, `${s.action} needs a name`);
});
