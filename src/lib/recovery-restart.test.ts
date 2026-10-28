// Integration: the restarted app drains the recovered recording's queue.
//
// Runs in its own process. The "previous session" left crash artifacts on the
// device (a persisted outbox with a create and two uploaded segments, a part
// in progress, and the session marker); this process starts fresh, recovers,
// and drains the queue through the REAL flush loop with fault injection.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { installPlatformMocks, makeKit, simulateCrashMidRecording } from "./recoveryTestKit.ts";

const kit = makeKit("restart");
installPlatformMocks(kit);

const { recoverInterruptedRecording } = await import("./recorder.ts");
const { flush, pendingOps } = await import("./sync.ts");

const RECORDING = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const QUEUE_KEY = "sync.queue.v1";
const pendingDir = () => path.join(kit.root, "documents", "pending-audio");

/** The outbox the crashed session left: create queued, two parts kept on disk. */
function seedCrashedSession() {
  const store = fs.existsSync(kit.storageFile) ? JSON.parse(fs.readFileSync(kit.storageFile, "utf8")) : {};
  const seg = (idx: number) => ({
    kind: "segment",
    recordingId: RECORDING,
    idx,
    localUri: path.join(pendingDir(), `${RECORDING}-${String(idx).padStart(4, "0")}.wav`),
    ext: "wav",
    durationMs: 300_000,
    attempts: 0,
    nextAt: 0,
  });
  const create = {
    kind: "create",
    recordingId: RECORDING,
    title: "Crash test",
    template: "meeting",
    source: "mic",
    consentAt: "2026-10-28T00:00:00.000Z",
    createdAt: "2026-10-28T00:00:00.000Z",
    attempts: 0,
    nextAt: 0,
  };
  fs.mkdirSync(pendingDir(), { recursive: true });
  for (const idx of [1, 2]) fs.writeFileSync(seg(idx).localUri, Buffer.alloc(44 + 5000, 7));
  store[QUEUE_KEY] = JSON.stringify([create, seg(1), seg(2)]);
  fs.writeFileSync(kit.storageFile, JSON.stringify(store));
}

/** Simulate the user reopening the app later: every backoff timer has expired. */
function expireBackoff() {
  const store = JSON.parse(fs.readFileSync(kit.storageFile, "utf8"));
  const q = JSON.parse(store[QUEUE_KEY]);
  for (const op of q) op.nextAt = 0;
  store[QUEUE_KEY] = JSON.stringify(q);
  fs.writeFileSync(kit.storageFile, JSON.stringify(store));
}

async function clearSessionMarker() {
  const store = JSON.parse(fs.readFileSync(kit.storageFile, "utf8"));
  delete store["recorder.active.v1"];
  fs.writeFileSync(kit.storageFile, JSON.stringify(store));
}

test("not signed in: the queue survives untouched (nothing is lost while offline)", async () => {
  seedCrashedSession();
  kit.session = null;
  await flush();
  const q = await pendingOps();
  assert.equal(q.length, 3, "all three ops still queued");
  assert.equal(kit.calls.upload.length, 0, "nothing uploaded without a session");
});

test("signed in: recovered part is queued and the whole recording drains in order", async () => {
  kit.session = { user: { id: "user-1" }, access_token: "test-token" };
  const crashed = simulateCrashMidRecording(kit, { recordingId: RECORDING, segIdx: 3, doneMs: 600_000, partBytes: 9000 });
  const part = crashed.currentUri;
  expireBackoff();
  // Injecting the failure before recovery makes the auto-flush triggered by
  // enqueue deterministic: create succeeds, segment 1 fails, the rest blocks.
  kit.fail.upload = 1;

  const recovered = await recoverInterruptedRecording();
  assert.equal(recovered, RECORDING);
  await flush();
  const ops = await pendingOps();
  assert.deepEqual(
    ops.map((o) => [o.kind, "idx" in o ? o.idx : null]),
    [
      ["segment", 1],
      ["segment", 2],
      ["segment", 3],
      ["finalize", null],
    ],
    "create ran; the failed segment keeps the rest of the recording queued",
  );
  assert.equal(ops[0].attempts, 1, "the failure was recorded");
  assert.ok(ops[0].nextAt > Date.now() - 1000, "a backoff time was set");
  assert.ok(fs.existsSync("localUri" in ops[0] ? ops[0].localUri : ""), "the local file is kept until the upload succeeds");
  assert.ok(kit.tables["recordings"]?.has(RECORDING), "the recording row exists (create ran)");
  assert.equal(kit.calls.invoke.length, 0, "no finalize ran while a segment was failing");

  // A second flush right now must NOT retry the failed upload (backoff window).
  const uploadsAfterFirst = kit.calls.upload.length;
  await flush();
  assert.equal(kit.calls.upload.length, uploadsAfterFirst, "backoff prevents an immediate retry");
  assert.ok(fs.existsSync("localUri" in ops[0] ? ops[0].localUri : ""), "the file is still kept during the backoff window");
  // The queue now on disk is exactly what the next app open (recovery-reopen.test.ts,
  // its own process) will pick up once the backoff has expired.
});

test("the recording row is created before anything else is sent", async () => {
  assert.ok(kit.calls.upserts.length >= 1, "at least the create ran");
  assert.ok(
    kit.calls.upserts[0].startsWith("recordings:"),
    `the first server write is the recordings row (got ${kit.calls.upserts[0]})`,
  );
});

test("an on-device (local) recording recovers, transcribes, and posts the transcript", async () => {
  const recordingId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  kit.fail.invoke = 0;
  const crashed = simulateCrashMidRecording(kit, { recordingId, segIdx: 1, doneMs: 30_000, partBytes: 9000, local: true });
  const part = crashed.currentUri;

  const recovered = await recoverInterruptedRecording();
  assert.equal(recovered, recordingId);

  await flush();
  assert.deepEqual(
    (await pendingOps()).filter((o) => o.recordingId === recordingId).map((o) => o.kind),
    [],
    "local ops drained",
  );
  assert.ok(kit.calls.invoke.includes("ingest/local-transcript"), "transcript posted to the server");
  assert.equal(fs.existsSync(part), false, "the local WAV was consumed by transcription");
  const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`local-stt:${recordingId}`));
  assert.deepEqual(keys, [], "transcript scratch keys removed after posting");

  // The server-side failure path: the transcript stays recoverable.
  kit.fail.invoke = 1;
  fs.writeFileSync(part, Buffer.alloc(44 + 9000, 7));
  const { enqueue } = await import("./sync.ts");
  await enqueue({ kind: "local_segment", recordingId, idx: 2, localUri: part, offsetMs: 30_000, durationMs: 0 });
  await enqueue({ kind: "local_finalize", recordingId, durationMs: 30_000 });
  await flush();
  // Transcription succeeded, so the WAV was consumed by design; the recovered
  // text is the artifact that must survive until the server accepts it.
  assert.ok(
    (await AsyncStorage.getAllKeys()).some((k) => k.startsWith(`local-stt:${recordingId}`)),
    "transcript kept while the server is unreachable",
  );
  assert.ok(
    (await pendingOps()).some((o) => o.recordingId === recordingId && o.kind === "local_finalize"),
    "finalize retained for retry",
  );
});
