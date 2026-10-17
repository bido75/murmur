// SCIM 2.0 provisioning for a team (Okta, Microsoft Entra ID, OneLogin, JumpCloud).
// Deploy with --no-verify-jwt. Base URL: <SUPABASE_URL>/functions/v1/scim/v2
// Auth: `Authorization: Bearer scim_…` (made by a team admin in the app).
// Adding a person creates their Murmur account if needed and adds them to the team; deactivating
// or deleting removes them from the team (their personal recordings stay theirs). Owners are
// never removed by SCIM.
import { adminClient, corsHeaders } from '../_shared/services.ts';
import { sha256 } from '../_shared/mcp_source.ts';
import { activeFrom, emailOf, listResponse, parseFilter, scimError, SERVICE_PROVIDER_CONFIG, USER_SCHEMA, userResource, type Member } from '../_shared/scim.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const send = (r: { status: number; body: unknown }) =>
  new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/scim+json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = adminClient();
  const auth = req.headers.get('Authorization') ?? '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!tok.startsWith('scim_')) return send(scimError(401, 'Missing SCIM token'));
  const { data: t } = await db.from('scim_tokens').select('id, workspace_id').eq('token_hash', await sha256(tok)).maybeSingle();
  if (!t) return send(scimError(401, 'Invalid or revoked SCIM token'));
  await db.from('scim_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', t.id);
  const ws = t.workspace_id as string;

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('v2');
  const [res, id] = i >= 0 ? parts.slice(i + 1) : [];
  const base = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/functions/v1/scim/v2`;
  try {
    if (res === 'ServiceProviderConfig') return send({ status: 200, body: SERVICE_PROVIDER_CONFIG });
    if (res === 'ResourceTypes') return send({ status: 200, body: { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 1, Resources: [{ id: 'User', name: 'User', endpoint: '/Users', schema: USER_SCHEMA }] } });
    if (res === 'Schemas') return send({ status: 200, body: { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 1, Resources: [{ id: USER_SCHEMA, name: 'User' }] } });
    if (res !== 'Users') return send(scimError(404, 'Not found'));

    const members = async (): Promise<Member[]> => {
      const { data } = await db.rpc('scim_members', { ws });
      return ((data ?? []) as Omit<Member, 'active'>[]).map((m) => ({ ...m, active: true }));
    };
    const audit = (act: string, uid: string, email: string) => db.rpc('audit', { ws, act, ttype: 'user', tid: uid, m: { email, source: 'scim' }, who: null });
    const add = async (email: string) => {
      let uid = (await db.rpc('user_id_by_email', { em: email })).data as string | null;
      if (!uid) {
        const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
        if (error || !data.user) throw new Error(error?.message ?? 'Could not create the account');
        uid = data.user.id;
      }
      const { error } = await db.from('workspace_members').upsert({ workspace_id: ws, user_id: uid, role: 'member', email }, { onConflict: 'workspace_id,user_id', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      await audit('scim.user_added', uid, email);
      return uid;
    };
    const remove = async (m: Member) => {
      if (m.role === 'owner') return false;
      await db.from('workspace_members').delete().eq('workspace_id', ws).eq('user_id', m.user_id);
      await audit('scim.user_removed', m.user_id, m.email);
      return true;
    };

    if (req.method === 'GET' && !id) {
      const f = parseFilter(url.searchParams.get('filter'));
      if (f === 'unsupported') return send(scimError(400, 'Only userName eq "…" filters are supported', 'invalidFilter'));
      const all = (await members()).filter((m) => !f || m.email === f.email).map((m) => userResource(m, base));
      return send({ status: 200, body: listResponse(all, Number(url.searchParams.get('startIndex') ?? 1), Number(url.searchParams.get('count') ?? 100)) });
    }
    if (req.method === 'POST' && !id) {
      const body = await req.json();
      const email = emailOf(body);
      if (!email) return send(scimError(400, 'userName or emails must be an email address', 'invalidValue'));
      if ((await members()).some((m) => m.email === email)) return send(scimError(409, 'Already a member', 'uniqueness'));
      if (body.active === false) return send(scimError(400, 'Create the user as active', 'invalidValue'));
      const uid = await add(email);
      return send({ status: 201, body: userResource({ user_id: uid, email, role: 'member', joined_at: new Date().toISOString(), active: true }, base) });
    }
    if (!id || !UUID.test(id)) return send(scimError(404, 'User not found'));
    const m = (await members()).find((x) => x.user_id === id);

    if (req.method === 'GET') return m ? send({ status: 200, body: userResource(m, base) }) : send(scimError(404, 'User not found'));
    if (req.method === 'DELETE') {
      if (!m) return send(scimError(404, 'User not found'));
      return (await remove(m)) ? send({ status: 204, body: null }) : send(scimError(400, 'Team owners can only be removed in the app', 'mutability'));
    }
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = await req.json();
      const active = activeFrom(body);
      if (active === false && m) {
        if (!(await remove(m))) return send(scimError(400, 'Team owners can only be removed in the app', 'mutability'));
        return send({ status: 200, body: userResource({ ...m, active: false }, base) });
      }
      if (active === true && !m) {
        const { data: u } = await db.auth.admin.getUserById(id);
        if (!u.user?.email) return send(scimError(404, 'User not found'));
        await add(u.user.email.toLowerCase());
        return send({ status: 200, body: userResource({ user_id: id, email: u.user.email.toLowerCase(), role: 'member', joined_at: new Date().toISOString(), active: true }, base) });
      }
      if (!m) return send(scimError(404, 'User not found'));
      return send({ status: 200, body: userResource(m, base) }); // names etc. aren't stored
    }
    return send(scimError(405, 'Method not allowed'));
  } catch (e) {
    console.error('scim error', e);
    return send(scimError(500, (e as Error).message));
  }
});
