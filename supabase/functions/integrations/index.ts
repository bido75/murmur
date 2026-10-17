// POST { action: 'connect', provider, token, email?, site? }  → checks the token, saves it server-side
// POST { action: 'targets', provider }                          → teams/projects tasks can go to
// POST { action: 'set_target', provider, target: {id, name} }   → choose where tasks go
// Tokens are stored where the app can never read them back.
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { listTargets, PROVIDERS, TOKEN_PROVIDERS, verifyToken, type Config, type Provider, type Target } from '../_shared/trackers.ts';
import { listTargets as procoreTargets } from '../_shared/procore.ts';
import { notionPages } from '../_shared/destinations.ts';
import { env as procoreEnv, loadProcore, procoreAccess } from '../_shared/procore_db.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { id: userId } = await requireUser(req);
    const body = await req.json();
    const provider = body.provider as Provider;
    // Trackers plus destinations connected with a token (Notion) or by signing in (Slack, Salesforce, Google Docs, OneNote).
    const ALL = [...PROVIDERS, 'notion', 'slack', 'google_docs', 'onenote', 'aircall'];
    if (!ALL.includes(provider)) throw new HttpError(400, 'Unknown provider');
    const admin = adminClient();

    if (body.action === 'connect' && (provider as string) === 'notion') {
      const token = String(body.token ?? '').trim();
      const me = await fetch('https://api.notion.com/v1/users/me', { headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' } });
      if (!me.ok) throw new HttpError(400, 'Notion rejected that token. Use an internal integration secret (starts with ntn_ or secret_).');
      const who = await me.json();
      const config = { account: who?.bot?.workspace_name ?? 'Notion' };
      const { error } = await admin.from('integrations').upsert({ user_id: userId, provider, secret: token, config }, { onConflict: 'user_id,provider' });
      if (error) throw new Error(error.message);
      return json({ provider, config });
    }

    if (body.action === 'connect') {
      if (!TOKEN_PROVIDERS.includes(provider)) throw new HttpError(400, 'This one connects by signing in, not with a token.');
      const token = String(body.token ?? '').trim();
      if (!token) throw new HttpError(400, 'Paste a token first');
      const config: Config = {};
      if (provider === 'jira') {
        config.email = String(body.email ?? '').trim();
        config.site = String(body.site ?? '').trim();
      }
      if (provider === 'trello') config.key = String(body.key ?? '').trim();
      if (provider === 'hubspot') config.target = { id: 'tasks', name: 'HubSpot tasks' };
      config.account = await verifyToken(provider, token, config).catch((e) => {
        throw new HttpError(400, (e as Error).message);
      });
      const { error } = await admin
        .from('integrations')
        .upsert({ user_id: userId, provider, secret: token, config }, { onConflict: 'user_id,provider' });
      if (error) throw new Error(error.message);
      return json({ provider, config });
    }

    const { data: row } = await admin.from('integrations').select('secret, config').eq('user_id', userId).eq('provider', provider).maybeSingle();
    if (!row) throw new HttpError(404, 'Not connected');

    if (body.action === 'targets' && (provider as string) === 'notion') {
      return json({ targets: await notionPages(row.secret) });
    }

    if (body.action === 'targets') {
      if (provider === 'procore') {
        const full = (await loadProcore(userId))!;
        return json({ targets: await procoreTargets(procoreEnv(), await procoreAccess(userId, full)) });
      }
      const targets = await listTargets(provider, row.secret, row.config as Config);
      return json({ targets });
    }

    if (body.action === 'set_target') {
      const target = body.target as Target;
      if (!target?.id || !target?.name) throw new HttpError(400, 'target is required');
      const config = { ...(row.config as Config), target: { id: String(target.id), name: String(target.name) } };
      const { error } = await admin.from('integrations').update({ config }).eq('user_id', userId).eq('provider', provider);
      if (error) throw new Error(error.message);
      return json({ provider, config });
    }

    throw new HttpError(400, 'Unknown action');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: (e as Error).message }, status);
  }
});
