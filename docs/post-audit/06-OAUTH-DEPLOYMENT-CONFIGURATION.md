# 06 — OAuth deployment configuration

## Public origin: LIVE (2026-10-28)

The public HTTPS origin is **`https://notes.giscop.com`** — a Cloudflare Tunnel
(`murmur-app`) in front of the local Supabase gateway:

```
app / providers → https://notes.giscop.com (Cloudflare edge, proxied CNAME)
              → cloudflared connector (container `cloudflared-notes`, token-run)
              → host.docker.internal:54321 (kong: auth, REST, storage, functions)
```

Verified end-to-end: tunnel status `healthy`; `/rest/v1/…` with the anon key →
200; `/functions/v1/calendar/providers` → the function's own auth check answers
through the domain.

- Ingress (remotely managed): `notes.giscop.com → http://host.docker.internal:54321`,
  everything else → 404.
- DNS: `CNAME notes.giscop.com → <tunnel-id>.cfargotunnel.com` (proxied).
- `PUBLIC_API_BASE_URL=https://notes.giscop.com` is set in
  `supabase/functions/.env` (gitignored) and the Edge Runtime restarted.

**Migration story (why this survives moving hosts):** the domain, the CNAME and
the tunnel ingress live in the Cloudflare account — nothing to migrate. The only
thing that moves to the hosting platform is the **connector** (the
`docker run cloudflare/cloudflared … --token …` container) plus the app stack.
Because the ingress service is `host.docker.internal:54321`, it points at
whatever host the connector runs on — the same command works unchanged as long
as the Supabase stack runs in Docker there.

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