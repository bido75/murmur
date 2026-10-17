// Team admin actions that need the server.
//   POST /verify-domain { domain } → checks the DNS TXT record and marks the domain verified
import { adminClient, corsHeaders, HttpError, json, requireUser } from '../_shared/services.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { id: userId, client } = await requireUser(req);
    const route = new URL(req.url).pathname.split('/').pop();
    if (req.method === 'POST' && route === 'verify-domain') {
      const domain = String((await req.json()).domain ?? '').toLowerCase().trim();
      // RLS: only admins of the claiming team can see the row.
      const { data: d } = await client.from('workspace_domains').select('domain, workspace_id, verify_token, verified_at').eq('domain', domain).maybeSingle();
      if (!d) throw new HttpError(404, 'Domain not found');
      if (d.verified_at) return json({ verified: true });
      let records: string[][] = [];
      try {
        records = await Deno.resolveDns(domain, 'TXT');
      } catch {
        records = [];
      }
      const found = records.some((r) => r.join('').trim() === d.verify_token);
      if (!found) return json({ verified: false, expected: d.verify_token });
      const admin = adminClient();
      await admin.from('workspace_domains').update({ verified_at: new Date().toISOString() }).eq('domain', domain);
      await admin.rpc('audit', { ws: d.workspace_id, act: 'domain.verified', ttype: 'domain', tid: domain, m: {}, who: userId });
      return json({ verified: true });
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('admin error', e);
    return json({ error: (e as Error).message }, status);
  }
});
