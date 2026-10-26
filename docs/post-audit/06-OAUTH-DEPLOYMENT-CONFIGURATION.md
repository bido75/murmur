# 06 — OAuth deployment configuration

## Current state (verified)

- `publicApiBaseUrl()` (in `services.ts`) resolves the public origin in order:
  `PUBLIC_API_BASE_URL` → `EXTERNAL_SUPABASE_URL` → `SUPABASE_URL`.
- `calendar`, `connect` and `procore` build their redirect URIs from it.
- `/calendar/providers` reports `["google"]` and `/connect/available` reports
  `["slack","google_docs"]` against the local stack (verified by curl).

## Local development values (in `supabase/functions/.env`, gitignored)

| Variable | Local value shape | Purpose |
|---|---|---|
| `EXTERNAL_SUPABASE_URL` | `http://<LAN-IP>:54325` | reachable address for OAuth callbacks and signed downloads |
| `APP_URL` | `http://<LAN-IP>:8090` | validates OAuth return addresses |
| `APP_SCHEME` | `murmur` | allows the native deep-link return |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | provided | Calendar + Google Docs connect |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | provided | Slack destination connect |
| `PROCORE_CLIENT_ID` / `PROCORE_CLIENT_SECRET` | provided | Procore connect (sandbox via `PROCORE_LOGIN_URL` etc.) |

## Redirect URIs to register per provider

| Provider | Redirect URI |
|---|---|
| Google (Calendar + Docs) | `{PUBLIC_API_BASE_URL}/functions/v1/calendar/callback` and `{PUBLIC_API_BASE_URL}/functions/v1/connect/callback` |
| Slack | `{PUBLIC_API_BASE_URL}/functions/v1/connect/callback` |
| Procore | `{PUBLIC_API_BASE_URL}/functions/v1/procore/callback` |

`PUBLIC_API_BASE_URL` must be **public HTTPS** — Google rejects private-IP
redirects (the `device_id and device_name are required for private IP` error).
Two supported options:

1. A tunnel in front of the local server (`cloudflared tunnel --url http://10.0.0.180:54325`),
   then set `PUBLIC_API_BASE_URL=https://<tunnel>.trycloudflare.com` and restart
   the Edge Runtime.
2. The deployed backend domain (`notes.giscop.com`), already registered for some
   providers per the operator's env notes — verify each URI matches the paths
   above.

## Operator checklist to unlock live OAuth

1. Expose a public HTTPS origin for the server.
2. Set `PUBLIC_API_BASE_URL` in `supabase/functions/.env`.
3. Register each redirect URI above in the provider console.
4. `powershell -ExecutionPolicy Bypass -File scripts\restart-local-functions.ps1 -FromFunctionsEnv`
5. In the app: Settings → Calendar → Connect Google; Connections → Slack.
6. Record: consent screen shown → callback lands → connection row created →
   account label shown in Settings.