import assert from "node:assert/strict";
import test from "node:test";
import { nextOwnerAction, quarantineName } from "./queueOwner.ts";

test("the first account on a machine adopts the queue", () => {
  assert.equal(nextOwnerAction(null, "user-a"), "keep");
});

test("the same account keeps its queue", () => {
  assert.equal(nextOwnerAction("user-a", "user-a"), "keep");
});

test("a different account rotates the queue away", () => {
  assert.equal(nextOwnerAction("user-a", "user-b"), "rotate");
  // A signed-out session followed by another sign-in still rotates: the queued
  // recordings were made under the earlier account.
  assert.equal(nextOwnerAction("user-a", null), "rotate");
});

test("a signed-out session with no prior owner keeps", () => {
  assert.equal(nextOwnerAction(null, null), "keep");
});

test("quarantine files are named by owner", () => {
  assert.equal(quarantineName("user-a"), "queue-user-a.json");
});
