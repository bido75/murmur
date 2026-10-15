// POST /delete { confirm: "DELETE" } — permanently deletes the signed-in user's account:
// their files, then their data (shared team work is handed to a teammate first), then the login.
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!new URL(req.url).pathname.endsWith('/delete') || req.method !== 'POST') throw new HttpError(404, 'Not found');
    const { id: userId } = await requireUser(req);
    const { confirm } = await req.json().catch(() => ({}));
    if (confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
    const admin = adminClient();

    const { data: blocking } = await admin.rpc('teams_blocking_deletion', { uid: userId });
    if (blocking?.length) {
      const names = (blocking as { name: string }[]).map((b) => b.name).join(', ');
      throw new HttpError(409, `You're the only owner of ${names}. Make someone else an owner (or remove the other members) first, so the team isn't left without one.`);
    }

    // Files first: rows are needed to find them, and storage isn't covered by database cascades.
    await removeFiles(admin, 'audio', (await admin.from('recording_segments').select('storage_path').eq('user_id', userId)).data);
    await removeFiles(admin, 'photos', (await admin.from('recording_photos').select('storage_path').eq('user_id', userId)).data);
    await removeFolder(admin, 'exports', userId);

    const { error: prepErr } = await admin.rpc('prepare_account_deletion', { uid: userId });
    if (prepErr) throw new Error(prepErr.message);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return json({ deleted: true });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('account delete failed', e);
    return json({ error: (e as Error).message }, status);
  }
});

// deno-lint-ignore no-explicit-any
async function removeFiles(admin: any, bucket: string, rows: { storage_path: string | null }[] | null) {
  const paths = (rows ?? []).map((r) => r.storage_path).filter((p): p is string => !!p);
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 500));
    if (error) throw new Error(`Couldn't remove ${bucket} files: ${error.message}`);
  }
}

/** exports/<user>/<random>/<file>: list two levels and remove everything. */
// deno-lint-ignore no-explicit-any
async function removeFolder(admin: any, bucket: string, userId: string) {
  const { data: dirs } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
  const paths: string[] = [];
  for (const d of dirs ?? []) {
    const { data: files } = await admin.storage.from(bucket).list(`${userId}/${d.name}`, { limit: 100 });
    if (files?.length) paths.push(...files.map((f: { name: string }) => `${userId}/${d.name}/${f.name}`));
    else paths.push(`${userId}/${d.name}`);
  }
  for (let i = 0; i < paths.length; i += 500) await admin.storage.from(bucket).remove(paths.slice(i, i + 500));
}
