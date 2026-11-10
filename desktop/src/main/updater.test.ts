import assert from "node:assert/strict";
import test from "node:test";
import { channelOf, isNewerVersion, updatesEnabled } from "./updater.ts";

test("a beta version reports the prerelease channel", () => {
  assert.equal(channelOf("0.2.0-beta.1"), "prerelease");
  assert.equal(channelOf("1.0.0"), "stable");
});

test("updates are refused without verified signing, whatever else is set", () => {
  const r = updatesEnabled({ envFlag: true, signingVerified: false, channel: "stable" });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /signed/);
});

test("updates are refused when the operator has not enabled them", () => {
  const r = updatesEnabled({ envFlag: false, signingVerified: true, channel: "stable" });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /MURMUR_ENABLE_UPDATES/);
});

test("prerelease builds never self-update", () => {
  const r = updatesEnabled({ envFlag: true, signingVerified: true, channel: "prerelease" });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /by hand/);
});

test("a signed, enabled, stable build may check for updates", () => {
  const r = updatesEnabled({ envFlag: true, signingVerified: true, channel: "stable" });
  assert.equal(r.allowed, true);
});

test("version comparison: newer patch, minor and major are all newer", () => {
  assert.equal(isNewerVersion("0.2.1", "0.2.0"), true);
  assert.equal(isNewerVersion("0.3.0", "0.2.9"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.2.0", "0.2.0"), false);
  assert.equal(isNewerVersion("0.1.9", "0.2.0"), false);
});

test("a v prefix is tolerated in release names", () => {
  assert.equal(isNewerVersion("v0.3.0", "0.2.0"), true);
});
