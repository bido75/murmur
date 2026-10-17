// Team admin actions that need the server.
//   POST /verify-domain { domain } → checks the DNS TXT record and marks the domain verified
//   POST /email-invite { code }     → emails a team invite (needs RESEND_API_KEY and RECAP_FROM)
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
    if (req.method === 'POST' && route === 'email-invite') {
      const key = Deno.env.get('RESEND_API_KEY');
      const from = Deno.env.get('RECAP_FROM');
      if (!key || !from) return json({ sent: false, reason: 'email not set up' });
      const code = String((await req.json()).code ?? '');
      // RLS: only admins of the team see its invites.
      const { data: inv } = await client.from('workspace_invites').select('email, code, workspace_id, expires_at, workspaces(name)').eq('code', code).maybeSingle();
      if (!inv) throw new HttpError(404, 'Invite not found');
      const { data: me } = await client.auth.getUser();
      const team = (Array.isArray(inv.workspaces) ? inv.workspaces[0] : inv.workspaces)?.name ?? 'a team';
      const app = Deno.env.get('APP_NAME') ?? 'Murmur';
      const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
      const pretty = String(inv.code).replace(/(.{4})(?=.)/g, '$1-');
      const link = appUrl ? `${appUrl}/join?code=${encodeURIComponent(String(inv.code))}` : null;
      const text = [
        `${me.user?.email ?? 'A teammate'} invited you to join ${team} on ${app}.`,
        '',
        `Sign in with ${inv.email}, then open Settings → Join a team and enter: ${pretty}`,
        ...(link ? ['', `Or open: ${link}`] : []),
        '',
        `The code expires on ${String(inv.expires_at).slice(0, 10)}.`,
      ].join('\n');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [inv.email], reply_to: me.user?.email ? [me.user.email] : undefined, subject: `Join ${team} on ${app}`.slice(0, 200), text }),
      });
      if (!res.ok) throw new Error(`Email failed (${res.status})`);
      await adminClient().rpc('audit', { ws: inv.workspace_id, act: 'invite.emailed', ttype: 'invite', tid: inv.email, m: {}, who: userId });
      return json({ sent: true });
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('admin error', e);
    return json({ error: (e as Error).message }, status);
  }
});
