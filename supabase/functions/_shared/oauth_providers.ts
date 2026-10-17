// Sign-in connections for destinations: Slack, Salesforce, Google Docs, OneNote. Pure; tested.

export type OAuthProvider = 'slack' | 'salesforce' | 'google_docs' | 'onenote';
export const OAUTH_PROVIDERS: OAuthProvider[] = ['slack', 'salesforce', 'google_docs', 'onenote'];

export type ProviderConf = { authorize: string; token: string; scope: string; idEnv: string; secretEnv: string; extra?: Record<string, string> };

export function providerConf(p: OAuthProvider, get: (k: string) => string | undefined): ProviderConf {
  const sf = (get('SALESFORCE_LOGIN_URL') ?? 'https://login.salesforce.com').replace(/\/$/, '');
  switch (p) {
    case 'slack':
      // Incoming webhook: the user picks one channel; we only ever post to it.
      return { authorize: 'https://slack.com/oauth/v2/authorize', token: 'https://slack.com/api/oauth.v2.access', scope: 'incoming-webhook', idEnv: 'SLACK_CLIENT_ID', secretEnv: 'SLACK_CLIENT_SECRET' };
    case 'salesforce':
      return { authorize: `${sf}/services/oauth2/authorize`, token: `${sf}/services/oauth2/token`, scope: 'api refresh_token', idEnv: 'SALESFORCE_CLIENT_ID', secretEnv: 'SALESFORCE_CLIENT_SECRET' };
    case 'google_docs':
      // drive.file: only files this app creates, never the rest of the user's Drive.
      return {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        scope: 'openid email https://www.googleapis.com/auth/drive.file',
        idEnv: 'GOOGLE_CLIENT_ID',
        secretEnv: 'GOOGLE_CLIENT_SECRET',
        extra: { access_type: 'offline', prompt: 'consent' },
      };
    case 'onenote':
      return {
        authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        scope: 'openid email offline_access User.Read Notes.Create',
        idEnv: 'MICROSOFT_CLIENT_ID',
        secretEnv: 'MICROSOFT_CLIENT_SECRET',
        extra: { prompt: 'select_account' },
      };
  }
}

export function authorizeUrl(conf: ProviderConf, clientId: string, redirectUri: string, state: string): string {
  const u = new URL(conf.authorize);
  u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: conf.scope, state, ...(conf.extra ?? {}) }).toString();
  return u.toString();
}

export function codeExchangeBody(clientId: string, secret: string, code: string, redirectUri: string): URLSearchParams {
  return new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: secret, code, redirect_uri: redirectUri });
}

export function refreshBody(clientId: string, secret: string, refreshToken: string, scope?: string): URLSearchParams {
  return new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: refreshToken, ...(scope ? { scope } : {}) });
}

/** What we keep from each provider's token response. */
export function storedConnection(p: OAuthProvider, body: Record<string, unknown>): { secret: string; access?: string; expiresIn?: number; config: Record<string, unknown> } {
  if (p === 'slack') {
    const hook = body.incoming_webhook as { url?: string; channel?: string; channel_id?: string } | undefined;
    if (body.ok === false || !hook?.url) throw new Error(`Slack didn't connect: ${String(body.error ?? 'no channel chosen')}`);
    return { secret: hook.url, config: { account: (body.team as { name?: string } | undefined)?.name ?? 'Slack', target: { id: hook.channel_id ?? '', name: hook.channel ?? 'channel' } } };
  }
  const refresh = String(body.refresh_token ?? '');
  if (!refresh) throw new Error('The sign-in didn’t return a refresh token. Try connecting again.');
  const config: Record<string, unknown> = {};
  if (p === 'salesforce') {
    if (!body.instance_url) throw new Error('Salesforce didn’t return an instance address.');
    config.instance_url = String(body.instance_url);
    config.account = String(body.instance_url).replace(/^https:\/\//, '');
  }
  return { secret: refresh, access: body.access_token ? String(body.access_token) : undefined, expiresIn: Number(body.expires_in ?? 3600) || 3600, config };
}

/** Salesforce: escape a value for a SOQL string literal. */
export function soqlString(v: string): string {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Google Drive multipart upload that converts a .docx into a Google Doc. */
export function driveMultipart(title: string, docx: Uint8Array, boundary = `murmur${crypto.randomUUID().replace(/-/g, '')}`): { body: Uint8Array; contentType: string } {
  const meta = JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document' });
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + docx.length + tail.length);
  body.set(head, 0);
  body.set(docx, head.length);
  body.set(tail, head.length + docx.length);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}
