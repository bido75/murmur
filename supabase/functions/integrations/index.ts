// POST { action: 'connect', provider, token, email?, site? }  → checks the token, saves it server-side
// POST { action: 'targets', provider }                          → teams/projects tasks can go to
// POST { action: 'set_target', provider, target: {id, name} }   → choose where tasks go
// Tokens are stored where the app can never read them back.
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';
import { listTargets, PROVIDERS, verifyToken, type Config, type Provider, type Target } from '../_shared/trackers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { id: userId } = await requireUser(req);
    const body = await req.json();
    const provider = body.provider as Provider;
    if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'Unknown provider');
    const admin = adminClient();

    if (body.action === 'connect') {
      const token = String(body.token ?? '').trim();
      if (!token) throw new HttpError(400, 'Paste a token first');
      const config: Config = {};
      if (provider === 'jira') {
        config.email = String(body.email ?? '').trim();
        config.site = String(body.site ?? '').trim();
      }
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

    if (body.action === 'targets') {
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
