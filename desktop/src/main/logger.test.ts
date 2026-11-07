import assert from "node:assert/strict";
import test from "node:test";
import { LOG_KEEP, MAX_LOG_BYTES, logLine, logName, rotationPlan } from "./logger.ts";

test("a fresh log is not rotated", () => {
  const p = rotationPlan(0);
  assert.equal(p.rotate, false);
  assert.equal(p.keepAfterRotate, LOG_KEEP - 1);
});

test("a full log rotates", () => {
  assert.equal(rotationPlan(MAX_LOG_BYTES).rotate, true);
  assert.equal(rotationPlan(MAX_LOG_BYTES - 1).rotate, false);
});

test("custom budgets are honored", () => {
  assert.equal(rotationPlan(10, 10).rotate, true);
  assert.equal(rotationPlan(9, 10).rotate, false);
});

test("file names: newest plain, oldest highest number", () => {
  assert.equal(logName(0), "app.log");
  assert.equal(logName(1), "app.1.log");
  assert.equal(logName(2), "app.2.log");
});

test("one log line per event, bounded length, valid JSON", () => {
  const line = logLine("uncaughtException", `boom\nwith\tnewlines ${"x".repeat(2000)}`);
  const parsed = JSON.parse(line) as { at: string; kind: string; message: string };
  assert.equal(parsed.kind, "uncaughtException");
  assert.ok(parsed.message.length <= 500);
  assert.ok(!parsed.message.includes("\n"));
  assert.ok(parsed.at);
});

test("a missing message becomes an empty one, not a crash", () => {
  const parsed = JSON.parse(logLine("unhandledRejection", undefined as unknown as string));
  assert.equal(parsed.message, "");
});
