// Upload outbox for the desktop app; the same server pipeline as the phone app.
import type { Bridge } from "../shared/bridge";
import { markFailed, runnable, storagePath, type Op } from "../shared/queue";
import { nextOwnerAction } from "../shared/queueOwner";
import { supabase } from "./supabase";
import { transcribeSegment } from "./speech";

declare const window: Window & { murmur: Bridge };
const bridge = () => window.murmur;

/** Where the words made from each part are kept until the whole recording is sent. */
const LOCAL_TEXT_PREFIX = "local-stt:";

type NewOp = Op extends infer T
  ? T extends Op
    ? Omit<T, "attempts" | "nextAt">
    : never
  : never;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const onQueueChange = (fn: () => void) => (
  listeners.add(fn),
  () => listeners.delete(fn)
);
export const getQueue = async () => (await bridge().queueGet()) as Op[];

async function save(q: Op[]) {
  await bridge().queueSet(q);
  listeners.forEach((l) => l());
}

export async function enqueue(op: NewOp) {
  await ensureOwner();
  const q = await getQueue();
  q.push({ ...op, attempts: 0, nextAt: 0 } as Op);
  await save(q);
  void flush();
}

/**
 * The queue belongs to exactly one account. Before any op is added or run, the
 * previous account's queue is quarantined under its own id, so a recording can
 * never be uploaded under someone else's session.
 */
async function ensureOwner() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const userId = data.session.user.id;
  const last = (await bridge().queueOwner()) as string | null;
  if (nextOwnerAction(last, userId) === "rotate") await bridge().queueRotate(userId);
}

export function flush(): Promise<void> {
  running ??= run().finally(() => (running = null));
  return running;
}

async function run() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  await ensureOwner();
  const userId = data.session.user.id;
  // Keep going until nothing is runnable (each recording's ops run in order).
  for (let guard = 0; guard < 200; guard++) {
    const q = await getQueue();
    const ready = runnable(q, Date.now());
    if (!ready.length) return;
    for (const op of ready) {
      const current = await getQueue();
      const i = current.findIndex(
        (o) => o === op || JSON.stringify(o) === JSON.stringify(op),
      );
      try {
        await perform(op, userId);
        if (i >= 0) current.splice(i, 1);
      } catch (e) {
        if (i >= 0)
          current[i] = markFailed(op, (e as Error).message, Date.now());
      }
      await save(current);
    }
  }
}

async function perform(op: Op, userId: string) {
  if (op.kind === "create") {
    const { error } = await supabase.from("recordings").upsert(
      {
        id: op.recordingId,
        user_id: userId,
        title: op.title,
        template: op.template,
        source: op.video ? "screen" : "mic",
        has_video: Boolean(op.video),
        channels: op.channels ?? 1,
        status: "recording",
        project_id: op.projectId,
        consent_method: op.consentMethod,
        consent_confirmed_at: op.consentAt,
        created_at: op.createdAt,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return;
  }
  if (op.kind === "segment") {
    const path = storagePath(userId, op);
    const size = await bridge().fileSize(op.recordingId, op.idx, op.ext);
    if (size > 0) {
      const bytes = await bridge().fileRead(op.recordingId, op.idx, op.ext);
      const type = op.video ? "video/webm" : "audio/webm";
      const { error } = await supabase.storage
        .from("audio")
        .upload(path, new Blob([bytes as BlobPart], { type }), {
          upsert: true,
          contentType: type,
        });
      if (error) throw new Error(error.message);
    } else if (size === 0) {
      await bridge().fileDelete(op.recordingId, op.idx, op.ext); // empty part (stopped instantly): nothing to send
      return;
    }
    const { error } = await supabase
      .from("recording_segments")
      .upsert(
        {
          recording_id: op.recordingId,
          user_id: userId,
          idx: op.idx,
          storage_path: path,
          duration_ms: op.durationMs,
        },
        { onConflict: "recording_id,idx" },
      );
    if (error) throw new Error(error.message);
    await bridge().fileDelete(op.recordingId, op.idx, op.ext); // only after the upload and its row are saved
    return;
  }
  if (op.kind === "local_segment") {
    // Transcribed on this computer: the part becomes words, which are kept until the
    // whole recording is sent. The audio is not uploaded.
    const key = `${LOCAL_TEXT_PREFIX}${op.recordingId}:${String(op.idx).padStart(4, "0")}`;
    if (!(await bridge().textGet(key))) {
      const language = (
        await supabase.from("user_settings").select("language").maybeSingle()
      ).data?.language;
      const utterances = await transcribeSegment(
        await bridge().fileRead(op.recordingId, op.idx, op.ext),
        op.offsetMs,
        (language as string | null) ?? null,
      );
      await bridge().textSet(key, JSON.stringify(utterances));
    }
    // The words are the record now, so the audio on this computer can go.
    await bridge().fileDelete(op.recordingId, op.idx, op.ext);
    return;
  }

  if (op.kind === "local_finalize") {
    const keys = await bridge().textKeys(
      `${LOCAL_TEXT_PREFIX}${op.recordingId}:`,
    );
    const parts = await Promise.all(keys.map((k) => bridge().textGet(k)));
    const utterances = parts.flatMap((v) =>
      v ? (JSON.parse(v) as unknown[]) : [],
    );
    if (!utterances.length) {
      const { error } = await supabase
        .from("recordings")
        .update({
          status: "failed",
          error: "No speech was heard in this recording.",
        })
        .eq("id", op.recordingId);
      if (error) throw new Error(error.message);
    } else {
      // The same route the phone app uses: the words go to the server, which writes the
      // notes from them. The audio never leaves this computer.
      const { data, error } = await supabase.functions.invoke(
        "ingest/local-transcript",
        {
          body: {
            recording_id: op.recordingId,
            utterances,
            duration_ms: op.durationMs,
          },
        },
      );
      if (error || data?.error)
        throw new Error(data?.error ?? error?.message ?? "Upload failed");
    }
    await bridge().textRemove(keys);
    return;
  }

  const { error } = await supabase
    .from("recordings")
    .update({ status: "uploading", duration_ms: op.durationMs })
    .eq("id", op.recordingId);
  if (error) throw new Error(error.message);
  const { error: fnErr } = await supabase.functions.invoke(
    "process-recording",
    { body: { recording_id: op.recordingId } },
  );
  if (fnErr) throw new Error(fnErr.message);
}

/** After a crash: queue the part that was being written, then finish the recording. */
export async function recoverInterrupted(): Promise<boolean> {
  const a = (await bridge().activeGet()) as {
    recordingId: string;
    idx: number;
    ext: string;
    doneMs: number;
    local?: boolean;
  } | null;
  if (!a) return false;
  const local = Boolean(a.local);
  if ((await bridge().fileSize(a.recordingId, a.idx, a.ext)) > 0) {
    await enqueue(
      local
        ? {
            kind: "local_segment",
            recordingId: a.recordingId,
            idx: a.idx,
            ext: a.ext,
            offsetMs: a.doneMs,
            durationMs: 0,
          }
        : {
            kind: "segment",
            recordingId: a.recordingId,
            idx: a.idx,
            ext: a.ext,
            durationMs: 0,
          },
    );
  }
  await enqueue(
    local
      ? { kind: "local_finalize", recordingId: a.recordingId, durationMs: a.doneMs }
      : { kind: "finalize", recordingId: a.recordingId, durationMs: a.doneMs },
  );
  await bridge().activeSet(null);
  return true;
}
