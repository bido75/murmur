import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStore,
  secureStorePath,
  serializeStore,
  storeMode,
} from "./secureStoreCore.ts";

test("the mode follows the OS capability, visibly", () => {
  assert.equal(storeMode(true), "os");
  assert.equal(storeMode(false), "plain");
});

test("an empty or corrupt store parses to empty, not a crash", () => {
  assert.deepEqual(parseStore(null), {});
  assert.deepEqual(parseStore(""), {});
  assert.deepEqual(parseStore("{nope"), {});
  assert.deepEqual(parseStore("[1,2]"), {});
});

test("entries round-trip through JSON", () => {
  const store = parseStore(
    serializeStore({ "sb-x": { plain: true, data: "hello" } }),
  );
  assert.equal(store["sb-x"].data, "hello");
  assert.equal(store["sb-x"].plain, true);
});

test("the file has one fixed name per directory", () => {
  assert.equal(secureStorePath("/u"), "/u/secure-store.json");
});
