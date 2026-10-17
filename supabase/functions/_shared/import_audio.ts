// Copy a finished call recording into our storage and process it (Deno).
import { adminClient } from './services.ts';
import { runPipeline } from './pipeline.ts';
import { segmentPath } from './ingest.ts';

const MAX_AUDIO_BYTES = 400 * 1024 * 1024;

export async function importAudioUrl(recordingId: string, userId: string, url: string, headers: Record<string, string> = {}) {
  const admin = adminClient();
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Couldn't download the call recording (${res.status})`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_AUDIO_BYTES) throw new Error('The recording is too large to import.');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = (res.headers.get('content-type') ?? 'audio/mpeg').split(';')[0];
    const ext = type.includes('wav') ? 'wav' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : 'mp3';
    const path = segmentPath(userId, recordingId, 1, ext);
    const { error } = await admin.storage.from('audio').upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw new Error(error.message);
    await admin.from('recording_segments').upsert({ recording_id: recordingId, user_id: userId, idx: 1, storage_path: path, duration_ms: 0 }, { onConflict: 'recording_id,idx' });
    await admin.from('recordings').update({ status: 'transcribing', error: null }).eq('id', recordingId);
    await runPipeline(recordingId);
  } catch (err) {
    console.error('import failed', recordingId, err);
    await admin.from('recordings').update({ status: 'failed', error: (err as Error).message.slice(0, 500) }).eq('id', recordingId);
  }
}
