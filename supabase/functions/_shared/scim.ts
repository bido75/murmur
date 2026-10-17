// SCIM 2.0 (RFC 7643/7644) — the subset identity providers use to add and remove people.
// Pure; tested.

export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export type Member = { user_id: string; email: string; role: string; joined_at: string; active: boolean };

export function scimError(status: number, detail: string, scimType?: string) {
  return { status, body: { schemas: [ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) } };
}

export function userResource(m: Member, base: string) {
  return {
    schemas: [USER_SCHEMA],
    id: m.user_id,
    userName: m.email,
    emails: [{ value: m.email, primary: true, type: 'work' }],
    active: m.active,
    meta: { resourceType: 'User', created: m.joined_at, location: `${base}/Users/${m.user_id}` },
  };
}

export function listResponse<T>(all: T[], startIndex: number, count: number) {
  const start = Math.max(1, startIndex || 1);
  const n = Math.max(0, Math.min(200, Number.isFinite(count) ? count : 100));
  return { schemas: [LIST_SCHEMA], totalResults: all.length, startIndex: start, itemsPerPage: Math.min(n, Math.max(0, all.length - start + 1)), Resources: all.slice(start - 1, start - 1 + n) };
}

/** Only `userName eq "x"` (and the same on emails.value) — what Okta and Entra send. */
export function parseFilter(f: string | null): { email: string } | null | 'unsupported' {
  if (!f) return null;
  const m = f.trim().match(/^(userName|emails(?:\.value)?|emails\[type eq "work"\]\.value)\s+eq\s+"([^"]+)"$/i);
  return m ? { email: m[2].toLowerCase() } : 'unsupported';
}

/** The email an IdP is creating or updating. */
export function emailOf(body: Record<string, unknown>): string | null {
  const emails = (body.emails as { value?: string; primary?: boolean }[] | undefined) ?? [];
  const v = (emails.find((e) => e.primary)?.value ?? emails[0]?.value ?? (body.userName as string | undefined) ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** Whether a PATCH (or PUT) turns the account on or off; undefined if it doesn't say. */
export function activeFrom(body: Record<string, unknown>): boolean | undefined {
  if (typeof body.active === 'boolean') return body.active;
  const ops = (body.Operations as { op?: string; path?: string; value?: unknown }[] | undefined) ?? [];
  let out: boolean | undefined;
  for (const o of ops) {
    const op = String(o.op ?? '').toLowerCase();
    if (op !== 'replace' && op !== 'add') continue;
    const asBool = (v: unknown) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined);
    if (String(o.path ?? '').toLowerCase() === 'active') out = asBool(o.value) ?? out;
    else if (!o.path && o.value && typeof o.value === 'object' && 'active' in (o.value as object)) out = asBool((o.value as { active: unknown }).active) ?? out;
  }
  return out;
}

export const SERVICE_PROVIDER_CONFIG = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'A SCIM token made in Murmur → Team → Security', primary: true }],
};
