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
- `calendar`, `connect` and `procore` build their redirect URIs from it.
- `/calendar/providers` reports `["google"]` and `/connect/available` reports
  `["slack","google_docs"]` against the local stack (verified by curl).

## Local development values (in `supabase/functions/.env`, gitignored)

| Variable | Local value shape | Purpose |
|---|---|---|
| `PUBLIC_API_BASE_URL` | `https://notes.giscop.com` | the public HTTPS origin for OAuth callbacks (cloudflared tunnel) |
| `EXTERNAL_SUPABASE_URL` | `http://<LAN-IP>:54325` | LAN-reachable address for signed downloads (phone on Wi-Fi) |
| `APP_URL` | `http://<LAN-IP>:8090` | validates OAuth return addresses |
| `APP_SCHEME` | `murmur` | allows the native deep-link return |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | provided | Calendar + Google Docs connect |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | provided | Slack destination connect |
| `PROCORE_CLIENT_ID` / `PROCORE_CLIENT_SECRET` | provided | Procore connect (sandbox via `PROCORE_LOGIN_URL` etc.) |

## Redirect URIs to register per provider (exact, with the live origin)

| Provider | Redirect URI |
|---|---|
| Google (Calendar + Docs) | `https://notes.giscop.com/functions/v1/calendar/callback` **and** `https://notes.giscop.com/functions/v1/connect/callback` |
| Slack | `https://notes.giscop.com/functions/v1/connect/callback` |
| Procore | `https://notes.giscop.com/functions/v1/procore/callback` |

## Operator checklist to unlock live OAuth

1. ~~Expose a public HTTPS origin for the server~~ **done** (`notes.giscop.com`).
2. ~~Set `PUBLIC_API_BASE_URL`~~ **done**.
3. **Register each redirect URI above in the provider console** (this is the
   step that unblocks BL-4a; Google's private-IP rejection is resolved by
   these public URIs).
4. In the app: Settings → Calendar → Connect Google; Connections → Slack.
5. Record: consent screen shown → callback lands → connection row created →
   account label shown in Settings (that is BL-4b).