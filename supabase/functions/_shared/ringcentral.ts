// RingCentral: sign-in, webhook subscription and call-recording lookup. Pure; tested.

export const RC_SERVER = 'https://platform.ringcentral.com';
export const RC_EVENT = '/restapi/v1.0/account/~/extension/~/telephony/sessions';

export function rcServer(get: (k: string) => string | undefined): string {
  return (get('RINGCENTRAL_SERVER') ?? RC_SERVER).replace(/\/$/, '');
}

export function rcAuthorizeUrl(server: string, clientId: string, redirectUri: string, state: string): string {
  const u = new URL(`${server}/restapi/oauth/authorize`);
  u.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state }).toString();
  return u.toString();
}

/** RingCentral wants the app's credentials as HTTP Basic auth on the token endpoint. */
export function rcTokenRequest(clientId: string, secret: string, body: Record<string, string>): { headers: Record<string, string>; body: URLSearchParams } {
  return {
    headers: { Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
  };
}

export function rcSubscriptionBody(hookUrl: string, verificationToken: string) {
  return {
    eventFilters: [RC_EVENT],
    deliveryMode: { transportType: 'WebHook', address: hookUrl, verificationToken },
    expiresIn: 604800, // 7 days; renewed daily by the scheduler
  };
}

export type RcSession = { sessionId: string; ended: boolean; direction: 'Inbound' | 'Outbound' | null; other: string | null; otherName: string | null };

/** A telephony-session notification. "Ended" = our party is Disconnected after having been answered. */
export function parseRcSession(body: unknown): RcSession | null {
  const b = ((body as { body?: unknown })?.body ?? null) as { telephonySessionId?: string; parties?: { status?: { code?: string }; direction?: string; from?: { phoneNumber?: string; name?: string }; to?: { phoneNumber?: string; name?: string }; extensionId?: string }[] } | null;
  if (!b?.telephonySessionId) return null;
  const parties = b.parties ?? [];
  const mine = parties.find((p) => p.extensionId) ?? parties[0];
  const code = mine?.status?.code ?? '';
  const dir = mine?.direction === 'Inbound' || mine?.direction === 'Outbound' ? mine.direction : null;
  const other = dir === 'Inbound' ? mine?.from : mine?.to;
  return { sessionId: String(b.telephonySessionId), ended: code === 'Disconnected', direction: dir, other: other?.phoneNumber ?? null, otherName: other?.name ?? null };
}

export type RcRecording = { id: string; contentUri: string; durationSec: number; startTime: string | null };

/** The recording on a detailed call-log record, if there is one. */
export function recordingFromCallLog(json: unknown): RcRecording | null {
  const rec = ((json as { records?: unknown[] })?.records ?? [])[0] as { duration?: number; startTime?: string; recording?: { id?: string | number; contentUri?: string } } | undefined;
  const r = rec?.recording;
  if (!r?.contentUri || !/^https:\/\//.test(r.contentUri)) return null;
  return { id: String(r.id ?? ''), contentUri: r.contentUri, durationSec: Number(rec?.duration ?? 0) || 0, startTime: rec?.startTime ?? null };
}

export function rcCallTitle(s: RcSession): string {
  const who = s.otherName || s.other || 'unknown number';
  return `${s.direction === 'Inbound' ? 'Call from' : 'Call with'} ${who}`.slice(0, 120);
}
