// Procore token storage (Deno). Refresh tokens rotate on every use, so the newest pair is
// saved before the access token is handed out.
import { adminClient } from './services.ts';
import { needsRefresh, procoreEnv, requestToken, tokenRequest, type ProcoreEnv } from './procore.ts';

export function env(): ProcoreEnv {
  const e = procoreEnv((k) => Deno.env.get(k));
  if (!e.clientId || !e.clientSecret) throw new Error("Procore isn't set up on the server yet (PROCORE_CLIENT_ID / PROCORE_CLIENT_SECRET).");
  return e;
}

export type ProcoreRow = { secret: string; access_secret: string | null; access_expires_at: string | null; config: Record<string, unknown> };

export async function loadProcore(userId: string): Promise<ProcoreRow | null> {
  const { data } = await adminClient()
    .from('integrations')
    .select('secret, access_secret, access_expires_at, config')
    .eq('user_id', userId)
    .eq('provider', 'procore')
    .maybeSingle();
  return (data as ProcoreRow | null) ?? null;
}

/** A valid access token for this user, refreshing (and saving the rotated refresh token) if needed. */
export async function procoreAccess(userId: string, row: ProcoreRow): Promise<string> {
  if (row.access_secret && !needsRefresh(row.access_expires_at)) return row.access_secret;
  const e = env();
  let tokens;
  try {
    tokens = await requestToken(e, tokenRequest(e, { refreshToken: row.secret }));
  } catch (err) {
    throw new Error(`Procore: couldn't renew the connection. Reconnect Procore in Settings. (${(err as Error).message})`);
  }
  const { error } = await adminClient()
    .from('integrations')
    .update({ secret: tokens.refresh_token, access_secret: tokens.access_token, access_expires_at: tokens.expires_at })
    .eq('user_id', userId)
    .eq('provider', 'procore');
  if (error) throw new Error(`Couldn't save the renewed Procore connection: ${error.message}`);
  row.secret = tokens.refresh_token;
  row.access_secret = tokens.access_token;
  row.access_expires_at = tokens.expires_at;
  return tokens.access_token;
}
