// POST { task_ids: string[], provider } → creates one tracker item per task, links it back.
// Tasks that are dismissed, still need review, or were already sent to this provider are skipped.
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { createIssue, describeTask, PROVIDERS, type Config, type Provider } from '../_shared/trackers.ts';
import { createPunchItem, type Attachment } from '../_shared/procore.ts';
import { env as procoreEnv, loadProcore, procoreAccess } from '../_shared/procore_db.ts';

type Result = { task_id: string; ok: boolean; url?: string; key?: string; skipped?: string; error?: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { id: userId, client } = await requireUser(req);
    const { task_ids, provider } = (await req.json()) as { task_ids: string[]; provider: Provider };
    if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'Unknown provider');
    if (!Array.isArray(task_ids) || !task_ids.length) throw new HttpError(400, 'task_ids is required');
    if (task_ids.length > 50) throw new HttpError(400, 'Send at most 50 tasks at a time');

    // Read tasks as the user (RLS), then the token with the service client.
    const { data: tasks, error } = await client
      .from('tasks')
      .select('id, text, owner, due_text, due_date, quote, quote_ms, status, needs_review, external, recording_id, photo_ids, recordings!tasks_recording_id_fkey(title, created_at)')
      .in('id', task_ids);
    if (error) throw new Error(error.message);

    const admin = adminClient();
    const { data: integ } = await admin.from('integrations').select('secret, config').eq('user_id', userId).eq('provider', provider).maybeSingle();
    if (!integ) throw new HttpError(400, `Connect ${provider} in Settings first`);

    const appUrl = Deno.env.get('APP_URL')?.replace(/\/$/, '') ?? null;
    const results: Result[] = [];
    let procoreRow: Awaited<ReturnType<typeof loadProcore>> = null;

    for (const t of tasks ?? []) {
      if (t.status === 'dismissed') { results.push({ task_id: t.id, ok: false, skipped: 'dismissed' }); continue; }
      if (t.needs_review) { results.push({ task_id: t.id, ok: false, skipped: 'needs review' }); continue; }
      const existing = (t.external ?? {})[provider];
      if (existing?.url) { results.push({ task_id: t.id, ok: true, url: existing.url, key: existing.key, skipped: 'already sent' }); continue; }

      try {
        const rec = (Array.isArray(t.recordings) ? t.recordings[0] : t.recordings) ?? { title: 'Recording', created_at: new Date().toISOString() };
        const link = appUrl && t.recording_id ? `${appUrl}/recording/${t.recording_id}` : null;
        const description = describeTask(t, rec, link);
        const created =
          provider === 'procore'
            ? await createPunchItem(
                procoreEnv(),
                await procoreAccess(userId, (procoreRow ??= (await loadProcore(userId))!)),
                ((integ.config as Config).target?.id ?? ''),
                { name: t.text, description },
                await taskPhotos(client, t.photo_ids ?? []),
              )
            : await createIssue(provider, integ.secret, integ.config as Config, { title: t.text, description, dueDate: t.due_date });
        const external = { ...(t.external ?? {}), [provider]: { id: created.id, key: created.key ?? null, url: created.url } };
        // The task was read through RLS above, so the caller is allowed to see (and update) it.
        await admin.from('tasks').update({ external }).eq('id', t.id);
        results.push({ task_id: t.id, ok: true, url: created.url, key: created.key });
      } catch (e) {
        results.push({ task_id: t.id, ok: false, error: (e as Error).message });
      }
    }
    return json({ results });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});

/** Up to 4 photos for a task, read through the user's own access (RLS) and downloaded server-side. */
// deno-lint-ignore no-explicit-any
async function taskPhotos(client: any, ids: string[]): Promise<Attachment[]> {
  if (!ids.length) return [];
  const { data } = await client.from('recording_photos').select('id, storage_path').in('id', ids.slice(0, 4));
  const out: Attachment[] = [];
  for (const p of (data ?? []) as { id: string; storage_path: string }[]) {
    const { data: blob } = await adminClient().storage.from('photos').download(p.storage_path);
    if (blob) out.push({ name: `photo-${p.id.slice(0, 8)}.jpg`, type: 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  return out;
}
