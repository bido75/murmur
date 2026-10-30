// Integration: the app died mid-recording; the next launch must recover it.
//
// These tests run the REAL recoverInterruptedRecording (recorder.ts) against a
// real temporary file system and a file-backed AsyncStorage double, with the
// crash artifacts written to disk exactly as the recorder leaves them. A
// companion file (recovery-restart.test.ts) runs in its own process and drains
// the queue the way the restarted app's sync loop does.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { installPlatformMocks, makeKit, simulateCrashMidRecording } from "./recoveryTestKit.ts";

const kit = makeKit("crash");
// The crash scenarios run "offline" (no signed-in session), so the auto-flush
// triggered by enqueue is a no-op and the queue state stays inspectable. The
// companion restart file drains the queue with a signed-in session.
kit.session = null;
installPlatformMocks(kit);

const { recoverInterruptedRecording } = await import("./recorder.ts");
const { pendingOps } = await import("./sync.ts");

function pendingDir() {
  return path.join(kit.root, "documents", "pending-audio");
}

test("no session marker means nothing to recover", async () => {
  assert.equal(await recoverInterruptedRecording(), null);
  assert.deepEqual(await pendingOps(), []);
});

test("a readable part in progress is moved to permanent storage and queued with a finalize", async () => {
  const recordingId = "11111111-1111-1111-1111-111111111111";
  simulateCrashMidRecording(kit, { recordingId, segIdx: 3, doneMs: 12 * 60 * 1000, partBytes: 8000 });
  const partUri = path.join(kit.root, "cache", `rec-${recordingId}-3.wav`);

  const recovered = await recoverInterruptedRecording();
  assert.equal(recovered, recordingId);

  const ops = await pendingOps();
  assert.deepEqual(
    ops.map((o) => [o.kind, "idx" in o ? o.idx : null]),
    [
      ["segment", 3],
      ["finalize", null],
    ],
  );
  // The part was moved into the pending folder (survives restarts), not copied.
  assert.equal(fs.existsSync(partUri), false, "part moved out of cache");
  const kept = fs.readdirSync(pendingDir()).find((f) => f.startsWith(recordingId));
  assert.ok(kept, "part is in the pending folder");
  assert.equal("localUri" in ops[0] ? ops[0].localUri : null, path.join(pendingDir(), kept));
  // The session marker is cleared, so the next launch cannot double-recover.
  const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
  assert.equal(await AsyncStorage.getItem("recorder.active.v1"), null);
});

test("a corrupted part is skipped, not fatal, and the original file is left alone", async () => {
  const recordingId = "22222222-2222-2222-2222-222222222222";
  simulateCrashMidRecording(kit, { recordingId, segIdx: 2, doneMs: 5 * 60 * 1000, partBytes: 100 });
  const partUri = path.join(kit.root, "cache", `rec-${recordingId}-2.wav`);

  const recovered = await recoverInterruptedRecording();
  assert.equal(recovered, recordingId);

  const ops = await pendingOps().then((all) => all.filter((o) => o.recordingId === recordingId));
  assert.deepEqual(
    ops.map((o) => o.kind),
    ["finalize"], // the corrupt part is skipped; the finalize always remains
    "no segment for the corrupt part",
  );
  assert.equal(fs.existsSync(partUri), true, "corrupt part is not deleted (user may want it)");
});

test("a missing part still finalizes, so the recording never hangs in recording", async () => {
  const recordingId = "33333333-3333-3333-3333-333333333333";
  const session = simulateCrashMidRecording(kit, { recordingId, segIdx: 1, doneMs: 0, partBytes: 0 });
  // The OS lost the file entirely (or it was on a wiped cache dir).
  fs.rmSync(session.currentUri);

  const recovered = await recoverInterruptedRecording();
  assert.equal(recovered, recordingId);

  const ops = await pendingOps().then((all) => all.filter((o) => o.recordingId === recordingId));
  assert.deepEqual(
    ops.map((o) => o.kind),
    ["finalize"],
    "only the finalize remains, with whatever was captured",
  );
});

test("running recovery twice after a crash mid-recovery queues nothing twice", async () => {
  const recordingId = "44444444-4444-4444-4444-444444444444";
  simulateCrashMidRecording(kit, { recordingId, segIdx: 1, doneMs: 60_000, partBytes: 9000 });

  await recoverInterruptedRecording();
  // Simulate the app crashing again after the ops were queued but before the
  // session marker was cleared: put the marker back and recover once more.
  const session = {
    recordingId,
    segIdx: 1,
    doneMs: 60_000,
    currentUri: path.join(pendingDir(), `${recordingId}-0001.wav`),
  };
  const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
  await AsyncStorage.setItem("recorder.active.v1", JSON.stringify(session));

  const before = await pendingOps();
  await recoverInterruptedRecording();
  const after = await pendingOps();
  assert.equal(after.length, before.length, "no duplicate ops from the second attempt");
  assert.equal(await AsyncStorage.getItem("recorder.active.v1"), null);
});

test("an on-device (local) recording recovers to local segment + local finalize", async () => {
  const recordingId = "55555555-5555-5555-5555-555555555555";
  simulateCrashMidRecording(kit, { recordingId, segIdx: 2, doneMs: 30_000, partBytes: 9000, local: true });

  const recovered = await recoverInterruptedRecording();
  assert.equal(recovered, recordingId);

  const ops = await pendingOps().then((all) => all.filter((o) => o.recordingId === recordingId));
  assert.deepEqual(
    ops.map((o) => [o.kind, "idx" in o ? o.idx : null]),
    [
      ["local_segment", 2],
      ["local_finalize", null],
    ],
  );
});
