// Upload outbox for the desktop app; the same server pipeline as the phone app.
import type { Bridge } from '../shared/bridge';
import { markFailed, runnable, storagePath, type Op } from '../shared/queue';
import { supabase } from './supabase';

declare const window: Window & { murmur: Bridge };
const bridge = () => window.murmur;

type NewOp = Op extends infer T ? (T extends Op ? Omit<T, 'attempts' | 'nextAt'> : never) : never;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const onQueueChange = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
export const getQueue = async () => (await bridge().queueGet()) as Op[];

async function save(q: Op[]) {
  await bridge().queueSet(q);
  listeners.forEach((l) => l());
}

export async function enqueue(op: NewOp) {
  const q = await getQueue();
  q.push({ ...op, attempts: 0, nextAt: 0 } as Op);
  await save(q);
  void flush();
}

export function flush(): Promise<void> {
  running ??= run().finally(() => (running = null));
  return running;
}

async function run() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const userId = data.session.user.id;
  // Keep going until nothing is runnable (each recording's ops run in order).
  for (let guard = 0; guard < 200; guard++) {
    const q = await getQueue();
    const ready = runnable(q, Date.now());
    if (!ready.length) return;
    for (const op of ready) {
      const current = await getQueue();
      const i = current.findIndex((o) => o === op || JSON.stringify(o) === JSON.stringify(op));
      try {
        await perform(op, userId);
        if (i >= 0) current.splice(i, 1);
      } catch (e) {
        if (i >= 0) current[i] = markFailed(op, (e as Error).message, Date.now());
      }
      await save(current);
    }
  }
}

async function perform(op: Op, userId: string) {
  if (op.kind === 'create') {
    const { error } = await supabase.from('recordings').upsert(
      {
        id: op.recordingId,
        user_id: userId,
        title: op.title,
        template: op.template,
        source: op.video ? 'screen' : 'mic',
        has_video: Boolean(op.video),
        status: 'recording',
        project_id: op.projectId,
        consent_method: op.consentMethod,
        consent_confirmed_at: op.consentAt,
        created_at: op.createdAt,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return;
  }
  if (op.kind === 'segment') {
    const path = storagePath(userId, op);
    const size = await bridge().fileSize(op.path);
    if (size > 0) {
      const bytes = await bridge().fileRead(op.path);
      const type = op.video ? 'video/webm' : 'audio/webm';
      const { error } = await supabase.storage.from('audio').upload(path, new Blob([bytes as BlobPart], { type }), { upsert: true, contentType: type });
      if (error) throw new Error(error.message);
    } else if (size === 0) {
      await bridge().fileDelete(op.path); // empty part (stopped instantly): nothing to send
      return;
    }
    const { error } = await supabase
      .from('recording_segments')
      .upsert({ recording_id: op.recordingId, user_id: userId, idx: op.idx, storage_path: path, duration_ms: op.durationMs }, { onConflict: 'recording_id,idx' });
    if (error) throw new Error(error.message);
    await bridge().fileDelete(op.path); // only after the upload and its row are saved
    return;
  }
  const { error } = await supabase.from('recordings').update({ status: 'uploading', duration_ms: op.durationMs }).eq('id', op.recordingId);
  if (error) throw new Error(error.message);
  const { error: fnErr } = await supabase.functions.invoke('process-recording', { body: { recording_id: op.recordingId } });
  if (fnErr) throw new Error(fnErr.message);
}

/** After a crash: queue the part that was being written, then finish the recording. */
export async function recoverInterrupted(): Promise<boolean> {
  const a = (await bridge().activeGet()) as { recordingId: string; idx: number; path: string; doneMs: number } | null;
  if (!a) return false;
  if ((await bridge().fileSize(a.path)) > 0) {
    await enqueue({ kind: 'segment', recordingId: a.recordingId, idx: a.idx, path: a.path, ext: 'webm', durationMs: 0 });
  }
  await enqueue({ kind: 'finalize', recordingId: a.recordingId, durationMs: a.doneMs });
  await bridge().activeSet(null);
  return true;
}
