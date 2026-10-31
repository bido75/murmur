// File-store behavior: atomic writes, defaults on missing/corrupt files, partial patches.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  deleteSettingsFile,
  loadSettings,
  saveSettings,
} from "./settings.ts";
import { DEFAULT_SETTINGS, normalize } from "../shared/settings.ts";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "murmur-settings-"));
}

test("missing file returns defaults", () => {
  const dir = freshDir();
  try {
    assert.deepEqual(loadSettings(dir), DEFAULT_SETTINGS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupt file falls back to defaults", () => {
  const dir = freshDir();
  try {
    writeFileSync(join(dir, "settings.json"), "{not json");
    assert.deepEqual(loadSettings(dir), DEFAULT_SETTINGS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("round-trip keeps valid values", () => {
  const dir = freshDir();
  try {
    const saved = saveSettings(dir, { theme: "dark", localOnly: true, retentionDays: 30 });
    assert.equal(saved.theme, "dark");
    assert.equal(saved.localOnly, true);
    assert.equal(saved.retentionDays, 30);
    assert.deepEqual(loadSettings(dir), saved);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no temporary file is left behind after saving", () => {
  const dir = freshDir();
  try {
    saveSettings(dir, { theme: "light" });
    assert.equal(existsSync(join(dir, "settings.json.tmp")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("partial patch preserves untouched settings", () => {
  const dir = freshDir();
  try {
    saveSettings(dir, { theme: "dark", localOnly: true });
    const again = saveSettings(dir, { theme: "light" });
    assert.equal(again.theme, "light");
    assert.equal(again.localOnly, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleting the file restores defaults", () => {
  const dir = freshDir();
  try {
    saveSettings(dir, { theme: "dark" });
    deleteSettingsFile(dir);
    assert.deepEqual(loadSettings(dir), DEFAULT_SETTINGS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid patch values are normalized on write", () => {
  const dir = freshDir();
  try {
    const saved = saveSettings(dir, { retentionDays: 9999 });
    assert.equal(saved.retentionDays, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalize is re-exported for renderer use", () => {
  assert.equal(typeof normalize, "function");
});
