// Where things live. OAuth needs the web app deployed (it hosts the consent page and,
// via rewrites, the discovery files, /mcp and /oauth/* on one domain).
import { canonicalResource } from './oauth.ts';

export function oauthConfig() {
  const supabase = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const app = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  const mcp = canonicalResource(Deno.env.get('MCP_URL') ?? (app ? `${app}/mcp` : `${supabase}/functions/v1/mcp`));
  const issuer = app || `${supabase}/functions/v1/oauth`;
  const base = app ? `${app}/oauth` : `${supabase}/functions/v1/oauth`;
  return {
    enabled: Boolean(app),
    issuer,
    mcp,
    endpoints: {
      issuer,
      authorize: app ? `${app}/oauth/authorize` : '',
      token: `${base}/token`,
      register: `${base}/register`,
      revoke: `${base}/revoke`,
    },
  };
}
