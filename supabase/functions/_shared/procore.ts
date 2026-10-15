// Procore: OAuth 2.0 (authorization code), punch items and daily log notes.
// Request building is pure and unit-tested; the fetch calls were written against Procore's
// public REST v1.0 docs and still need a run against a Procore sandbox company.

export type ProcoreEnv = { clientId: string; clientSecret: string; loginUrl: string; apiUrl: string; appUrl: string };

export function procoreEnv(get: (k: string) => string | undefined): ProcoreEnv {
  const trim = (s: string) => s.replace(/\/+$/, '');
  return {
    clientId: get('PROCORE_CLIENT_ID') ?? '',
    clientSecret: get('PROCORE_CLIENT_SECRET') ?? '',
    // Sandbox: set both URLs to https://sandbox.procore.com
    loginUrl: trim(get('PROCORE_LOGIN_URL') ?? 'https://login.procore.com'),
    apiUrl: trim(get('PROCORE_API_URL') ?? 'https://api.procore.com'),
    appUrl: trim(get('PROCORE_APP_URL') ?? 'https://app.procore.com'),
  };
}

export function authorizeUrl(env: ProcoreEnv, redirectUri: string, state: string): string {
  const u = new URL(`${env.loginUrl}/oauth/authorize`);
  u.search = new URLSearchParams({ response_type: 'code', client_id: env.clientId, redirect_uri: redirectUri, state }).toString();
  return u.toString();
}

export type TokenSet = { access_token: string; refresh_token: string; expires_at: string };

/** Body for the token endpoint (authorization_code or refresh_token grant). */
export function tokenRequest(env: ProcoreEnv, grant: { code: string; redirectUri: string } | { refreshToken: string }): Record<string, string> {
  return 'code' in grant
    ? { grant_type: 'authorization_code', client_id: env.clientId, client_secret: env.clientSecret, code: grant.code, redirect_uri: grant.redirectUri }
    : { grant_type: 'refresh_token', client_id: env.clientId, client_secret: env.clientSecret, refresh_token: grant.refreshToken };
}

/** Turn a token response into what we store. Procore access tokens last about 1.5–2 hours. */
export function toTokenSet(body: { access_token?: string; refresh_token?: string; expires_in?: number; created_at?: number }, now = Date.now()): TokenSet {
  if (!body.access_token || !body.refresh_token) throw new Error('Procore did not return tokens');
  const created = typeof body.created_at === 'number' ? body.created_at * 1000 : now;
  const lifetime = (typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600) * 1000;
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: new Date(Math.min(created, now) + lifetime).toISOString() };
}

/** Refresh a minute early so a request never starts with a token about to expire. */
export function needsRefresh(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  return !Number.isFinite(t) || t - now < 60_000;
}

export async function requestToken(env: ProcoreEnv, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`${env.loginUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Procore sign-in failed (${res.status}): ${json?.error_description ?? json?.error ?? json?.message ?? ''}`.trim());
  return toTokenSet(json);
}

// ---------- Targets: "Company / Project" ----------

export type Target = { id: string; name: string };

/** Target ids are "<companyId>:<projectId>", both numeric. */
export function parseTarget(id: string | undefined | null): { companyId: string; projectId: string } {
  const m = /^(\d+):(\d+)$/.exec(String(id ?? ''));
  if (!m) throw new Error('Choose a Procore project in Settings → Task trackers.');
  return { companyId: m[1], projectId: m[2] };
}

async function api<T>(env: ProcoreEnv, token: string, path: string, init: RequestInit & { companyId?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (init.companyId) headers['Procore-Company-Id'] = init.companyId;
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(`${env.apiUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 401) throw new Error('Procore: the connection expired. Reconnect Procore in Settings.');
    if (res.status === 403) throw new Error("Procore: your account doesn't have permission for this in that project (check the Punch List / Daily Log tool permissions).");
    throw new Error(`Procore request failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

export async function whoAmI(env: ProcoreEnv, token: string): Promise<string> {
  const me = await api<{ login?: string; name?: string }>(env, token, '/rest/v1.0/me');
  return me.login || me.name || 'Procore user';
}

export async function listTargets(env: ProcoreEnv, token: string): Promise<Target[]> {
  const companies = await api<{ id: number; name: string; is_active?: boolean }[]>(env, token, '/rest/v1.0/companies');
  const out: Target[] = [];
  const active = companies.filter((x) => x.is_active !== false).slice(0, 5);
  for (const c of active) {
    const projects = await api<{ id: number; name: string; display_name?: string; active?: boolean }[]>(
      env,
      token,
      `/rest/v1.0/projects?company_id=${c.id}&per_page=300&filters[by_status]=Active&serializer_view=compact`,
      { companyId: String(c.id) },
    );
    out.push(...projects.map((p) => ({ id: `${c.id}:${p.id}`, name: `${active.length > 1 ? `${c.name} / ` : ''}${p.display_name || p.name}` })));
  }
  return out;
}

// ---------- Punch items ----------

export type Attachment = { name: string; type: string; bytes: Uint8Array };

/**
 * The create-punch-item request. With photos it must be multipart (Rails-style nested
 * keys); without, plain JSON.
 */
export function punchItemRequest(projectId: string, item: { name: string; description: string }, attachments: Attachment[] = []): { body: string | FormData; json: boolean } {
  const name = item.name.replace(/\s+/g, ' ').trim().slice(0, 250) || 'Item from site walk';
  if (!attachments.length) {
    return { body: JSON.stringify({ project_id: Number(projectId), punch_item: { name, description: item.description } }), json: true };
  }
  const form = new FormData();
  form.append('project_id', projectId);
  form.append('punch_item[name]', name);
  form.append('punch_item[description]', item.description);
  for (const a of attachments) form.append('punch_item[attachments][]', new Blob([a.bytes as BlobPart], { type: a.type }), a.name);
  return { body: form, json: false };
}

export function punchItemUrl(env: ProcoreEnv, projectId: string, id: string | number): string {
  return `${env.appUrl}/${projectId}/project/punch_list/form/${id}`;
}

export async function createPunchItem(env: ProcoreEnv, token: string, targetId: string, item: { name: string; description: string }, attachments: Attachment[] = []) {
  const { companyId, projectId } = parseTarget(targetId);
  const req = punchItemRequest(projectId, item, attachments);
  const created = await api<{ id: number }>(env, token, '/rest/v1.0/punch_items', { method: 'POST', body: req.body, companyId });
  return { id: String(created.id), key: `Punch #${created.id}`, url: punchItemUrl(env, projectId, created.id) };
}

// ---------- Daily log ----------

/** Procore's daily log "Notes" entry for a date. Long logs are trimmed with a pointer back to the app. */
export function notesLogRequest(date: string, comment: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
  const MAX = 9000;
  const text = comment.length > MAX ? `${comment.slice(0, MAX - 40).trimEnd()}\n… (full log in the app)` : comment;
  return JSON.stringify({ notes_log: { date, comment: text } });
}

export async function createNotesLog(env: ProcoreEnv, token: string, targetId: string, date: string, comment: string) {
  const { companyId, projectId } = parseTarget(targetId);
  const created = await api<{ id: number }>(env, token, `/rest/v1.0/projects/${projectId}/notes_logs`, {
    method: 'POST',
    body: notesLogRequest(date, comment),
    companyId,
  });
  return { id: String(created.id), url: `${env.appUrl}/${projectId}/project/daily_log/list?date=${date}` };
}
