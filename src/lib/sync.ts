// Offline-safe outbox. Every server write for a recording goes through here, in order:
//   create → segment(s) → finalize
// The queue is persisted, so recordings made with no signal (or interrupted by a crash)
// upload automatically later. Local audio is deleted only after the upload succeeds.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { isWeb } from './dialog';
import { supabase } from './supabase';
import type { ConsentMethod, Template } from './types';

type Base = { recordingId: string; attempts: number; nextAt: number; lastError?: string };

export type CreateOp = Base & {
  kind: 'create';
  title: string;
  template: Template;
  source: 'mic' | 'import' | 'link';
  consentAt: string | null;
  consentMethod?: ConsentMethod;
  projectId?: string | null;
  calendarEventKey?: string | null;
  customTemplateId?: string | null;
  createdAt: string;
};
export type SegmentOp = Base & { kind: 'segment'; idx: number; localUri: string; ext: string; durationMs: number };
export type FinalizeOp = Base & { kind: 'finalize'; durationMs: number };
export type LinkOp = Base & { kind: 'link'; url: string };
export type NotesOp = Base & { kind: 'notes'; text: string };
export type PhotoOp = Base & { kind: 'photo'; photoId: string; localUri: string; takenMs: number | null; width: number; height: number };
// Transcribed on this phone: each WAV part becomes text (kept until sent), then the text is sent.
export type LocalSegmentOp = Base & { kind: 'local_segment'; idx: number; localUri: string; offsetMs: number; durationMs: number };
export type LocalFinalizeOp = Base & { kind: 'local_finalize'; durationMs: number };
export type Op = CreateOp | SegmentOp | FinalizeOp | PhotoOp | LinkOp | NotesOp | LocalSegmentOp | LocalFinalizeOp;
type NewOp<T> = Omit<T, 'attempts' | 'nextAt'>;

const KEY = 'sync.queue.v1';
const LOCAL_TEXT_PREFIX = 'local-stt:';
let queue: Op[] | null = null;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Folder where finished segments wait for upload (survives app restarts). Native only. */
let pendingDirCache: Directory | null = null;
function pendingDir(): Directory {
  pendingDirCache ??= new Directory(Paths.document, 'pending-audio');
  return pendingDirCache;
}

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

export async function enqueue(
  op: NewOp<CreateOp> | NewOp<SegmentOp> | NewOp<FinalizeOp> | NewOp<PhotoOp> | NewOp<LinkOp> | NewOp<NotesOp> | NewOp<LocalSegmentOp> | NewOp<LocalFinalizeOp>,
) {
  const q = await load();
  q.push({ ...op, attempts: 0, nextAt: 0 } as Op);
  await save();
  void flush();
}

/** Move a finished audio file into the pending folder so it survives restarts. */
export function keepFile(sourceUri: string, recordingId: string, idx: number, ext: string): string {
  // On the web the recording is an in-memory blob URL; it uploads in this session.
  if (isWeb) return sourceUri;
  const dir = pendingDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${recordingId}-${String(idx).padStart(4, '0')}.${ext}`);
  if (dest.exists) dest.delete();
  new File(sourceUri).moveSync(dest);
  return dest.uri;
}

/** Move a photo into the pending folder so it survives restarts (web: stays a blob URL). */
export function keepPhoto(sourceUri: string, recordingId: string, photoId: string): string {
  if (isWeb) return sourceUri;
  const dir = pendingDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${recordingId}-photo-${photoId}.jpg`);
  if (dest.exists) dest.delete();
  new File(sourceUri).moveSync(dest);
  return dest.uri;
}

/** Photos still waiting to upload for a recording, so the app can show them right away. */
export async function pendingPhotos(recordingId: string): Promise<PhotoOp[]> {
  return (await load()).filter((o): o is PhotoOp => o.kind === 'photo' && o.recordingId === recordingId);
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
      if (e instanceof LostAudioError) {
        q.splice(q.indexOf(op), 1);
        await save();
        continue;
      }
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
        consent_method: op.consentMethod ?? (op.consentAt ? 'told_everyone' : 'not_confirmed'),
        project_id: op.projectId ?? null,
        calendar_event_key: op.calendarEventKey ?? null,
        custom_template_id: op.customTemplateId ?? null,
        created_at: op.createdAt,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return;
  }

  if (op.kind === 'segment') {
    const path = `${userId}/${op.recordingId}/seg-${String(op.idx).padStart(4, '0')}.${op.ext}`;
    if (isWeb) {
      await uploadWeb(op, path);
    } else {
      await uploadNative(op, path, userId, accessToken);
    }
    const { error } = await supabase
      .from('recording_segments')
      .upsert(
        { recording_id: op.recordingId, user_id: userId, idx: op.idx, storage_path: path, duration_ms: op.durationMs },
        { onConflict: 'recording_id,idx' },
      );
    if (error) throw new Error(error.message);
    if (!isWeb) {
      const file = new File(op.localUri);
      if (file.exists) file.delete();
    }
    return;
  }

  if (op.kind === 'local_segment') {
    const key = `${LOCAL_TEXT_PREFIX}${op.recordingId}:${String(op.idx).padStart(4, '0')}`;
    if (!(await AsyncStorage.getItem(key))) {
      const { transcribeLocal } = await import('./localStt');
      const lang = (await supabase.from('user_settings').select('language').maybeSingle()).data?.language ?? null;
      const utterances = await transcribeLocal(op.localUri, op.offsetMs, lang as string | null);
      await AsyncStorage.setItem(key, JSON.stringify(utterances));
    }
    const file = new File(op.localUri);
    if (file.exists) file.delete();
    return;
  }

  if (op.kind === 'local_finalize') {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${LOCAL_TEXT_PREFIX}${op.recordingId}:`)).sort();
    const parts = await AsyncStorage.multiGet(keys);
    const utterances = parts.flatMap(([, v]) => (v ? (JSON.parse(v) as unknown[]) : []));
    if (!utterances.length) {
      await supabase.from('recordings').update({ status: 'failed', error: 'No speech was heard in this recording.' }).eq('id', op.recordingId);
    } else {
      const { data, error } = await supabase.functions.invoke('ingest/local-transcript', { body: { recording_id: op.recordingId, utterances, duration_ms: op.durationMs } });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Upload failed');
    }
    await AsyncStorage.multiRemove(keys);
    return;
  }

  if (op.kind === 'notes') {
    const { error } = await supabase.from('recordings').update({ user_notes: op.text.slice(0, 20000) || null }).eq('id', op.recordingId);
    if (error) throw new Error(error.message);
    return;
  }

  if (op.kind === 'link') {
    // The audio stays where it is; the transcriber downloads it from the link.
    const { error } = await supabase
      .from('recording_segments')
      .upsert({ recording_id: op.recordingId, user_id: userId, idx: 1, storage_path: null, source_url: op.url, duration_ms: 0 }, { onConflict: 'recording_id,idx' });
    if (error) throw new Error(error.message);
    return;
  }

  if (op.kind === 'photo') {
    const path = `${userId}/${op.recordingId}/${op.photoId}.jpg`;
    await uploadFile('photos', op.localUri, path, 'image/jpeg', accessToken, 'This browser photo was lost when the page reloaded.');
    const { error } = await supabase.from('recording_photos').upsert(
      { id: op.photoId, recording_id: op.recordingId, user_id: userId, storage_path: path, taken_ms: op.takenMs, width: op.width, height: op.height },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    if (!isWeb) {
      const file = new File(op.localUri);
      if (file.exists) file.delete();
    }
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

/** Upload a local file (native: background upload; web: blob) to a private bucket. */
async function uploadFile(bucket: string, localUri: string, path: string, mime: string, accessToken: string, lostMessage: string) {
  if (isWeb) {
    let blob: Blob;
    try {
      blob = await (await fetch(localUri)).blob();
    } catch {
      throw new LostAudioError(lostMessage);
    }
    const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: mime });
    if (error) throw new Error(error.message);
    return;
  }
  const file = new File(localUri);
  if (!file.exists) {
    // Uploaded on an earlier attempt, then removed locally; check it's on the server.
    const folder = path.split('/').slice(0, -1).join('/');
    const { data } = await supabase.storage.from(bucket).list(folder);
    if (!data?.some((f) => path.endsWith(f.name))) throw new LostAudioError('The file is missing from this device.');
    return;
  }
  const result = await file.upload(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: mime,
    sessionType: 'background',
    headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY, 'x-upsert': 'true', 'content-type': mime },
  });
  if (result.status < 200 || result.status >= 300) throw new Error(`Upload failed (${result.status}) ${result.body.slice(0, 120)}`);
}

/** The audio no longer exists anywhere; retrying can't help, so the op is dropped. */
class LostAudioError extends Error {}

async function uploadWeb(op: SegmentOp, path: string) {
  let blob: Blob;
  try {
    blob = await (await fetch(op.localUri)).blob();
  } catch {
    // Blob URLs don't survive a page reload; nothing left to upload.
    throw new LostAudioError('This browser recording was lost when the page reloaded.');
  }
  const { error } = await supabase.storage.from('audio').upload(path, blob, { upsert: true, contentType: mimeFor(op.ext) });
  if (error) throw new Error(error.message);
}

async function uploadNative(op: SegmentOp, path: string, userId: string, accessToken: string) {
  const file = new File(op.localUri);
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
