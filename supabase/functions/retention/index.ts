// Scheduled cleanup for retention settings. Deploy with --no-verify-jwt and call it daily with
// the header `x-cron-secret: <CRON_SECRET>` (see README for the pg_cron schedule).
// - "Keep audio for N days": the audio files go; transcript, notes and tasks stay.
// - "Keep recordings for N days": the whole recording goes (audio, photos, notes, tasks).
import { adminClient, json } from '../_shared/services.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Forbidden' }, 403);
  const admin = adminClient();
  const { data: due, error } = await admin.rpc('retention_due', { max_rows: 500 });
  if (error) return json({ error: error.message }, 500);

  // Fail recordings stuck in a transient state (a processing job that timed out
  // or died with its worker), so clients never wait forever.
  const { data: staleMoved, error: staleErr } = await admin.rpc('fail_stale_processing', { max_rows: 200 });
  if (staleErr) console.error('stale-processing sweep failed', staleErr.message);

  let audio = 0;
  let recordings = 0;
  const failures: string[] = [];
  for (const row of (due ?? []) as { recording_id: string; action: 'delete_audio' | 'delete_recording' }[]) {
    try {
      const { data: segs } = await admin.from('recording_segments').select('storage_path').eq('recording_id', row.recording_id);
      const audioPaths = (segs ?? []).map((s: { storage_path: string | null }) => s.storage_path).filter(Boolean) as string[];
      if (audioPaths.length) {
        const { error: e } = await admin.storage.from('audio').remove(audioPaths);
        if (e) throw e;
      }
      if (row.action === 'delete_audio') {
        await admin.from('recordings').update({ audio_deleted_at: new Date().toISOString() }).eq('id', row.recording_id);
        audio++;
      } else {
        const { data: photos } = await admin.from('recording_photos').select('storage_path').eq('recording_id', row.recording_id);
        const photoPaths = (photos ?? []).map((p: { storage_path: string }) => p.storage_path);
        if (photoPaths.length) await admin.storage.from('photos').remove(photoPaths);
        const { error: e } = await admin.from('recordings').delete().eq('id', row.recording_id);
        if (e) throw e;
        recordings++;
      }
    } catch (e) {
      failures.push(`${row.recording_id}: ${(e as Error).message}`);
    }
  }
  if (failures.length) console.error('retention failures', failures.slice(0, 20));
  return json({ audio_removed: audio, recordings_removed: recordings, failed: failures.length, stale_failed: staleMoved ?? 0, more: (due ?? []).length === 500 });
});
