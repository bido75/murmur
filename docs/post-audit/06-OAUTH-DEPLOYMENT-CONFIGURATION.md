# 06 — OAuth deployment configuration

## Public origin: LIVE (2026-10-28)

`https://notes.giscop.com` serves **both** the web app and the API, over one
Cloudflare Tunnel (`murmur-app`) with path-based routing:

```
Browser / providers → https://notes.giscop.com (Cloudflare edge, proxied CNAME)
                   → cloudflared connector (container `cloudflared-notes`, token-run)
                   →  /rest/v1|/auth/v1|/storage/v1|/functions/v1/*  → kong :54321
                      everything else                                → web app :8090
```

- The web app is a static export (`npx expo export --platform web`, output
  `dist-web`) served by `scripts/serve-web-dist.cjs` on port 8090 with SPA
  fallback, **built with `EXPO_PUBLIC_SUPABASE_URL=https://notes.giscop.com` and
  `EXPO_PUBLIC_APP_URL=https://notes.giscop.com`** so the browser calls the same
  origin it was served from.
- Ingress (remotely managed): `notes.giscop.com` with
  `path ^/(rest|auth|storage|functions)/v1/` → `host.docker.internal:54321`;
  `notes.giscop.com` (everything else) → `host.docker.internal:8090`;
  fallback → 404.
- DNS: `CNAME notes.giscop.com → <tunnel-id>.cfargotunnel.com` (proxied).
- `PUBLIC_API_BASE_URL=https://notes.giscop.com` is set in
  `supabase/functions/.env` (gitignored) and the Edge Runtime restarted.

**Why not an `api.` subdomain:** `api.notes.giscop.com` is a second-level
subdomain, which Cloudflare's Universal SSL certificate (`*.giscop.com`) does
not cover — the TLS handshake fails before the tunnel is reached. Path-based
routing on `notes.giscop.com` works with the zone's free certificate and keeps
the OAuth redirects single-origin (no CORS at all). The `api.notes.giscop.com`
DNS record was removed; it can be re-added only together with Advanced
Certificate Manager / Total TLS on the zone.

**Migration story (why this survives moving hosts):** the domain, the CNAME and
the tunnel ingress live in the Cloudflare account — nothing to migrate. The only
thing that moves to the hosting platform is the **connector** (the
`docker run cloudflare/cloudflared … --token …` container) plus the app stack:
the exported web app served on 8090 and the Supabase stack behind kong. Because
the ingress services use `host.docker.internal`, they point at whatever host the
connector runs on — the same commands work unchanged as long as both services
run there.

`host.docker.internal` requires `--add-host host.docker.internal:host-gateway`
on Linux hosts (Docker Desktop provides it natively). Note it down for the
migration runbook.

## Current state (verified)

- `publicApiBaseUrl()` (in `services.ts`) resolves the public origin in order:
  `PUBLIC_API_BASE_URL` → `EXTERNAL_SUPABASE_URL` → `SUPABASE_URL`.
- `calendar`, `connect` and `procore` build their redirect URIs from it, and
  validate the app's `return_to` against `APP_URL` — which must be the web
  origin (`https://notes.giscop.com`), or connect buttons fail with 400.
- Sign-in codes: requested through the public domain → verified → session →
  `calendar/start` returns the provider consent URL (verified end-to-end
  2026-10-28 with a real code read from Mailpit).
- `/calendar/providers` reports `["google"]` and `/connect/available` reports
  `["slack","google_docs"]` against the local stack (verified by curl).

## Sign-in codes: Mailpit (dev) vs real email

- **Mailpit is the local catch-all**, not a mail relay: GoTrue hands it the
  sign-in emails ("Your Murmur sign-in code", custom templates in
  `supabase/templates/`), and codes are read from its API for testing. It is
  **not exposed publicly** — port 54324 is not in the tunnel ingress, has no
  DNS record, and is unreachable through the domain (verified). Codes never
  leave the machine in dev.
- **For real delivery to users' inboxes**, enable the `[auth.email.smtp]`
  block in `supabase/config.toml` with real SMTP credentials
  (`pass = "env(SMTP_PASSWORD)"` keeps the secret out of the file; set the
  variable in the environment before `supabase start`). Also set
  `admin_email` / `sender_name` to a real sender on the giscop.com domain —
  the local default is `Admin <admin@email.com>`. **Do not enable SMTP with
  placeholder credentials** — GoTrue would fail to send sign-in codes until
  real values are present. Ask the operator for their chosen SMTP provider
  (cPanel mail, SendGrid, Postmark, …) and wire it then.
- Until SMTP is enabled, public visitors cannot receive real sign-in codes:
  the codes go to Mailpit on this machine. Sign-in over the public domain is
  therefore **dev-only until SMTP is wired** — that is an operator step, not
  a code defect.

## Local development values (in `supabase/functions/.env`, gitignored)

| Variable | Local value shape | Purpose |
|---|---|---|
| `PUBLIC_API_BASE_URL` | `https://notes.giscop.com` | the public HTTPS origin for OAuth callbacks (cloudflared tunnel) |
| `APP_URL` | `https://notes.giscop.com` | the web origin the functions accept as OAuth `return_to` |
| `EXTERNAL_SUPABASE_URL` | `http://<LAN-IP>:54325` | LAN-reachable address for signed downloads (phone on Wi-Fi) |
| `APP_SCHEME` | `murmur` | allows the native deep-link return |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | provided | Calendar + Google Docs connect |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | provided | Slack destination connect |
| `PROCORE_CLIENT_ID` / `PROCORE_CLIENT_SECRET` | provided | Procore connect (sandbox via `PROCORE_LOGIN_URL` etc.) |

## Redirect URIs to register per provider (exact, with the live origin)

| Provider | Redirect URI |
|---|---|
| Google Calendar | `https://notes.giscop.com/functions/v1/calendar/callback` (scopes: `openid email https://www.googleapis.com/auth/calendar.readonly`) |
| Google Docs (exports) | `https://notes.giscop.com/functions/v1/connect/callback` (scopes: `openid email https://www.googleapis.com/auth/drive.file` — files the app creates only, no `documents` scope needed) |
| Slack | `https://notes.giscop.com/functions/v1/connect/callback` |
| Procore | `https://notes.giscop.com/functions/v1/procore/callback` |

One Google Cloud OAuth client serves all Google integrations — the redirect URI
follows the app's callback endpoint, not the Google service. Register the
JavaScript origin `https://notes.giscop.com` too. `…/auth/callback/google`
(Supabase Auth's hosted broker) is only needed if you switch sign-in to
Supabase Auth's Google provider — Murmur signs in by email OTP and brokers
integrations itself, so it is optional.

## The edge-runtime JWT gate (root cause of `UNAUTHORIZED_NO_AUTH_HEADER`)

Supabase's edge runtime verifies a Supabase JWT on every function request by
default. Google's callback redirect carries `?code=…&state=…` and **no
Authorization header**, so the runtime rejected the browser redirect with
`UNAUTHORIZED_NO_AUTH_HEADER` *before the function ran* — the function code was
never the problem.

Fix (in `supabase/config.toml`): `verify_jwt = false` for every function whose
comment says "deploy with --no-verify-jwt" — 17 functions that authenticate
themselves instead (`requireUser` on user paths, one-time `state` tokens on
OAuth callbacks, webhook signatures, CRON secrets). Applied and verified:
a callback with an unknown state now returns the function's own "expired" page,
and with a valid state the full chain runs — state consumed (single-use),
token exchange attempted, `302 …?connected=slack:failed` on a bad code.

## MCP connectors (Claude.ai / ChatGPT)

Claude connects to `https://notes.giscop.com/mcp` and runs OAuth 2.1 itself:
it probes the endpoint unauthenticated (401 + `WWW-Authenticate: Bearer
resource_metadata=…`), fetches the protected-resource and authorization-server
discovery documents, registers a client dynamically (RFC 7591), then opens the
consent page. All of those must live on the web app's domain — the design in
`_shared/oauth_config.ts` expects the host to serve them (the same map
`scripts/hosting-config.mjs` writes for Vercel):

- `/mcp`, `/.well-known/oauth-protected-resource[/mcp]`,
  `/.well-known/oauth-authorization-server`, `/oauth/token`, `/oauth/register`,
  `/oauth/revoke` → the edge functions
- `/oauth/authorize` → the app's consent screen (SPA)

**The static server implements this map as a reverse proxy to kong**
(`scripts/serve-web-dist.cjs`). Without it every probe returned SPA HTML and
Claude failed with "Couldn't register with Murmur's sign-in service"
(dynamic client registration). Verified end-to-end over the domain:
401 + resource metadata hint → both discovery documents → DCR minted a client
for Claude's callback URL.

## Operator checklist to unlock live OAuth

1. ~~Expose a public HTTPS origin for the server~~ **done** (`notes.giscop.com`).
2. ~~Set `PUBLIC_API_BASE_URL`~~ **done**.
3. **Register each redirect URI above in the provider console** (this is the
   step that unblocks BL-4a; Google's private-IP rejection is resolved by
   these public URIs).
4. In the app: Settings → Calendar → Connect Google; Connections → Slack.
5. Record: consent screen shown → callback lands → connection row created →
   account label shown in Settings (that is BL-4b).