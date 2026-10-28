// Integration: the app is reopened after the first sync attempt failed; the
// backoff has expired and the transport is healthy again.
//
// Runs in its own process and starts from the on-device state the restart
// process left behind (modeled deterministically by the same helpers): the
// outbox holds the failed segment (attempts=1) and everything behind it, the
// recording row already exists server-side, and the segment files are on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { installPlatformMocks, makeKit } from "./recoveryTestKit.ts";

const kit = makeKit("reopen");
installPlatformMocks(kit);

const { flush, pendingOps } = await import("./sync.ts");

const RECORDING = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const QUEUE_KEY = "sync.queue.v1";
const pendingDir = () => path.join(kit.root, "documents", "pending-audio");

/** The persisted outbox the restart process left, with backoff timers expired. */
function seedAfterFailedRestart() {
  const seg = (idx: number, attempts: number) => ({
    kind: "segment",
    recordingId: RECORDING,
    idx,
    localUri: path.join(pendingDir(), `${RECORDING}-${String(idx).padStart(4, "0")}.wav`),
    ext: "wav",
    durationMs: 300_000,
    attempts,
    nextAt: 0,
  });
  const finalize = { kind: "finalize", recordingId: RECORDING, durationMs: 900_000, attempts: 0, nextAt: 0 };
  fs.mkdirSync(pendingDir(), { recursive: true });
  for (const s of [seg(1, 1), seg(2, 0), seg(3, 0)]) fs.writeFileSync(s.localUri, Buffer.alloc(44 + 5000, 7));
  const store = { [QUEUE_KEY]: JSON.stringify([seg(1, 1), seg(2, 0), seg(3, 0), finalize]) };
  fs.writeFileSync(kit.storageFile, JSON.stringify(store));
}

test("reopen: the whole recording drains without re-creating the recording row", async () => {
  seedAfterFailedRestart();
  kit.session = { user: { id: "user-1" }, access_token: "test-token" };

  await flush();
  assert.equal((await pendingOps()).length, 0, "queue fully drained");

  // No create again: the recording row already exists server-side.
  assert.equal(kit.calls.upserts.filter((u) => u.startsWith("recordings:")).length, 0, "create not repeated");
  const nativeUploads = kit.log.filter((e) => e.startsWith("upload:") && !e.startsWith("upload:storage:"));
  assert.equal(nativeUploads.length, 3, "all three segments uploaded");
  assert.deepEqual(kit.calls.invoke, ["process-recording"], "the AI pipeline was triggered once, after the audio");

  // Order: every segment upload precedes the pipeline invocation.
  const uploadIdx = kit.log.map((e) => e.startsWith("upload:") && !e.startsWith("upload:storage:")).lastIndexOf(true);
  const invokeIdx = kit.log.indexOf("invoke:process-recording");
  assert.ok(uploadIdx >= 0 && invokeIdx > uploadIdx, `pipeline invoked after all uploads (invoke at ${invokeIdx}, last upload at ${uploadIdx})`);

  // The finalize transitioned the recording out of "recording".
  assert.deepEqual(kit.calls.updates, [`recordings:${RECORDING}`], "status moved off recording");
  assert.equal(kit.tables["recording_segments"]?.size, 3, "all segments recorded server-side (upsert is idempotent)");

  // The audio files are cleaned up only after their uploads succeeded.
  for (const idx of [1, 2, 3]) {
    assert.equal(
      fs.existsSync(path.join(pendingDir(), `${RECORDING}-${String(idx).padStart(4, "0")}.wav`)),
      false,
      `segment ${idx} file removed after upload`,
    );
  }
});

test("reopen: a missing local file fails loudly and does not stall the queue forever", async () => {
  // A segment whose local file vanished (uploaded on an earlier attempt, or
  // lost): the real code checks the server and either records the row or
  // fails with a clear error instead of looping silently.
  const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const { enqueue } = await import("./sync.ts");
  await enqueue({
    kind: "segment",
    recordingId: id,
    idx: 1,
    localUri: path.join(pendingDir(), `${id}-0001.wav`), // never written to disk
    ext: "wav",
    durationMs: 1000,
  });
  await flush();
  const ghost = (await pendingOps()).find((o) => o.recordingId === id);
  assert.ok(ghost, "the missing-file op is not silently dropped");
  assert.match(String(ghost?.lastError), /missing|Upload failed/i, "the error names the problem");
  assert.ok((ghost?.attempts ?? 0) >= 1, "the failure is counted for backoff");
});
