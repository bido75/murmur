import assert from "node:assert/strict";
import test from "node:test";
import { SilenceGuard, dbfs, keepSegment } from "./level.ts";

test("a full-scale square wave is at the reference level", () => {
  const samples = Float32Array.from({ length: 2048 }, (_, i) =>
    i % 2 === 0 ? 1 : -1,
  );
  assert.ok(Math.abs(dbfs(samples)) < 0.001);
});

test("half amplitude loses 6 dB", () => {
  const loud = Float32Array.from({ length: 2048 }, (_, i) =>
    i % 2 === 0 ? 1 : -1,
  );
  const quiet = Float32Array.from({ length: 2048 }, (_, i) =>
    i % 2 === 0 ? 0.5 : -0.5,
  );
  const drop = dbfs(loud) - dbfs(quiet);
  assert.ok(Math.abs(drop - 6.02) < 0.01);
});

test("digital silence floors rather than exploding", () => {
  const silent = new Float32Array(2048);
  assert.equal(dbfs(silent), 20 * Math.log10(1e-8));
  assert.ok(Number.isFinite(dbfs(silent)));
});

test("empty input does not divide by zero", () => {
  assert.ok(Number.isFinite(dbfs(new Float32Array(0))));
});

test("silence warns once after the threshold, then stays quiet", () => {
  const g = new SilenceGuard(-50, 10_000);
  assert.equal(g.update(-10, 0), null); // loud: nothing pending
  assert.equal(g.update(-60, 1_000), null); // quiet starts
  assert.equal(g.update(-60, 9_000), null); // 8s quiet: not long enough
  assert.equal(g.update(-60, 11_000), null); // exactly 10s: the rule warns strictly after
  assert.equal(g.update(-60, 11_001), "warn"); // over the line: warn
  assert.equal(g.update(-60, 12_000), null); // still quiet: no second warning
});

test("coming back from silence clears the warning", () => {
  const g = new SilenceGuard(-50, 10_000);
  g.update(-60, 0);
  g.update(-60, 11_000);
  assert.equal(g.update(-20, 12_000), "clear");
  // And a later quiet stretch warns again, rather than being stuck clear forever.
  assert.equal(g.update(-60, 13_000), null);
  assert.equal(g.update(-60, 24_000), "warn");
});

test("short readings at exactly the threshold are not silence", () => {
  const g = new SilenceGuard(-50, 10_000);
  assert.equal(g.update(-50, 100_000), null);
});

test("segments under half a second are dropped", () => {
  assert.equal(keepSegment(499), false);
  assert.equal(keepSegment(500), false);
  assert.equal(keepSegment(501), true);
  assert.equal(keepSegment(60_000), true);
});
