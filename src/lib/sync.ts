// Offline-safe outbox. Every server write for a recording goes through here, in order:
//   create → segment(s) → finalize
// The queue is persisted, so recordings made with no signal (or interrupted by a crash)
// upload automatically later. Local audio is deleted only after the upload succeeds.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { supabase } from './supabase';
import type { Template } from './types';

type Base = { recordingId: string; attempts: number; nextAt: number; lastError?: string };

export type CreateOp = Base & {
  kind: 'create';
  title: string;
  template: Template;
  source: 'mic' | 'import';
  consentAt: string | null;
  createdAt: string;
};
export type SegmentOp = Base & { kind: 'segment'; idx: number; localUri: string; ext: string; durationMs: number };
export type FinalizeOp = Base & { kind: 'finalize'; durationMs: number };
export type Op = CreateOp | SegmentOp | FinalizeOp;

const KEY = 'sync.queue.v1';
let queue: Op[] | null = null;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Folder where finished segments wait for upload (survives app restarts). */
export const pendingDir = new Directory(Paths.document, 'pending-audio');

async function load(): Promise<Op[]> {
  if (queue) return queue;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    queue = raw ? (JSON.parse(raw) as Op[]) : [];
  } catch {
    queue = [];
  }
  return queue;
}

async function save() {
  await AsyncStorage.setItem(KEY, JSON.stringify(queue ?? []));
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function pendingOps(): Promise<Op[]> {
  return [...(await load())];
}

export async function enqueue(op: Omit<CreateOp, 'attempts' | 'nextAt'> | Omit<SegmentOp, 'attempts' | 'nextAt'> | Omit<FinalizeOp, 'attempts' | 'nextAt'>) {
  const q = await load();
  q.push({ ...op, attempts: 0, nextAt: 0 } as Op);
  await save();
  void flush();
}

/** Move a finished audio file into the pending folder so it survives restarts. */
export function keepFile(sourceUri: string, recordingId: string, idx: number, ext: string): string {
  if (!pendingDir.exists) pendingDir.create({ intermediates: true });
  const dest = new File(pendingDir, `${recordingId}-${String(idx).padStart(4, '0')}.${ext}`);
  if (dest.exists) dest.delete();
  new File(sourceUri).moveSync(dest);
  return dest.uri;
}

/** Process whatever is ready. Safe to call often; only one run at a time. */
export function flush(): Promise<void> {
  if (!running) {
    running = run().finally(() => {
      running = null;
    });
  }
  return running;
}

async function run() {
  const q = await load();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return;

  const blocked = new Set<string>(); // keep each recording's ops in order
  for (const op of [...q]) {
    if (blocked.has(op.recordingId)) continue;
    if (op.nextAt > Date.now()) {
      blocked.add(op.recordingId);
      continue;
    }
    try {
      await perform(op, session.user.id, session.access_token);
      q.splice(q.indexOf(op), 1);
    } catch (e) {
      op.attempts += 1;
      op.lastError = (e as Error).message;
      op.nextAt = Date.now() + Math.min(5000 * 2 ** op.attempts, 10 * 60 * 1000);
      blocked.add(op.recordingId);
    }
    await save();
  }
}

async function perform(op: Op, userId: string, accessToken: string) {
  if (op.kind === 'create') {
    const { error } = await supabase.from('recordings').upsert(
      {
        id: op.recordingId,
        user_id: userId,
        title: op.title,
        template: op.template,
        source: op.source,
        status: 'recording',
        consent_confirmed_at: op.consentAt,
        created_at: op.createdAt,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return;
  }

  if (op.kind === 'segment') {
    const file = new File(op.localUri);
    const path = `${userId}/${op.recordingId}/seg-${String(op.idx).padStart(4, '0')}.${op.ext}`;
    if (file.exists) {
      const result = await file.upload(`${SUPABASE_URL}/storage/v1/object/audio/${path}`, {
        httpMethod: 'POST',
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: mimeFor(op.ext),
        sessionType: 'background',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          'x-upsert': 'true',
          'content-type': mimeFor(op.ext),
        },
      });
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Upload failed (${result.status}) ${result.body.slice(0, 120)}`);
      }
    } else {
      // File already uploaded on a previous attempt and then removed; just record the row.
      const { data } = await supabase.storage.from('audio').list(`${userId}/${op.recordingId}`);
      if (!data?.some((f) => path.endsWith(f.name))) throw new Error('Audio file is missing');
    }
    const { error } = await supabase
      .from('recording_segments')
      .upsert(
        { recording_id: op.recordingId, user_id: userId, idx: op.idx, storage_path: path, duration_ms: op.durationMs },
        { onConflict: 'recording_id,idx' },
      );
    if (error) throw new Error(error.message);
    if (file.exists) file.delete();
    return;
  }

  // finalize
  const { error } = await supabase
    .from('recordings')
    .update({ status: 'uploading', duration_ms: op.durationMs })
    .eq('id', op.recordingId);
  if (error) throw new Error(error.message);
  await processRecording(op.recordingId);
}

export async function processRecording(recordingId: string) {
  const { error } = await supabase.functions.invoke('process-recording', { body: { recording_id: recordingId } });
  if (error) throw new Error(error.message);
}

export function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'm4a':
    case 'mp4':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    case 'mov':
      return 'video/quicktime';
    default:
      return 'application/octet-stream';
  }
}

/** Retry on a timer while the app is open. */
export function startSyncLoop(): () => void {
  void flush();
  const t = setInterval(() => void flush(), 30_000);
  return () => clearInterval(t);
}
