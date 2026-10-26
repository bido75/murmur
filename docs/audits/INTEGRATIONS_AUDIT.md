# Integrations audit

Per the audit rules: UI implemented / backend implemented / credentials
configured / sandbox test / live verification are recorded separately. Live
round-trips could not be run (needs provider console registration).

| Provider | Auth model in code | UI | Backend | Creds configured | Sandbox/live |
|---|---|---|---|---|---|
| Google Calendar | OAuth (server-held client id/secret) | yes (`settings.tsx` connect cards) | `calendar/index.ts` + `calendar_fetch.ts` | **yes** | `/calendar/providers` → `["google"]` verified; **live consent untested** |
| Microsoft Calendar | OAuth | yes | same | **no** (`MICROSOFT_*` not provided) | BLOCKED |
| Slack | OAuth (incoming webhook) | yes (`integrations.tsx`) | `connect/index.ts` + `destinations.ts` | **yes** | `/connect/available` → `["slack",...]` verified; **live consent untested** |
| Google Docs | OAuth (drive.file) | yes | same | **yes** (reuses Google creds) | available verified; live untested |
| OneNote | OAuth | yes | same | **no** (needs `MICROSOFT_*`) | BLOCKED |
| Salesforce | OAuth | yes | same | **no** | BLOCKED |
| Procore | OAuth + rotating refresh tokens | yes (`startProcoreConnect`) | `procore/index.ts` + `procore_db.ts` | **yes** (sandbox-ready via `PROCORE_*_URL`) | token-refresh logic unit-tested; live untested |
| Asana / Jira / Linear / monday / ClickUp / Trello | user-pasted personal token | yes (HELP copy per provider) | `trackers.ts` `verifyToken` + per-provider clients | n/a (user token) | `verifyToken` unit-tested |
| HubSpot | user-pasted **private app token** | yes (instructions corrected this branch) | `destinations.ts#logHubspot` → `api.hubapi.com` | n/a (user token; `pat-na2-…` is the right kind) | helpers unit-tested |
| Notion | user-pasted internal integration token | yes (with page-connection instructions) | `destinations.ts#exportNotion` | n/a | helpers unit-tested |
| Aircall | inbound webhook import | settings copy | `aircall/` + `capture.ts` | provided creds are API id/token, not webhook — **mismatch documented** | parse/verify unit-tested |
| RingCentral | OAuth | yes | `ringcentral/index.ts` | **no** | BLOCKED |
| Recall.ai (notetaker) | API key + signed webhook | settings copy | `bot/index.ts` | **no** | BLOCKED |
| Webhooks (outbound) | HMAC-signed, https-only, SSRF-guarded | `developers` page | `after_ready.ts` | n/a | constraint verified by SQL; delivery signing unit-tested |
| MCP / AI connectors | OAuth 2.1 server + hashed tokens | `api-access.tsx` | `mcp/` + `oauth/` | n/a | dynamic-client registration + token flows unit-tested; config-derived endpoint verified |

## Key mismatches found (documented, not forced)

1. The provided `env_murmur.md` targets a **different backend** (Express/Prisma on
   `notes.giscop.com`). Credentials were wired only where they map to this
   Supabase architecture: Google, Slack, Procore. Everything else is recorded in
   `docs/INTEGRATION_STATUS.md` with the exact reason.
2. `mcp-hubspot` OAuth client → HubSpot MCP install flow; Murmur connects HubSpot
   by private-app token. Documented to prevent misconfiguration.
3. Telephony: repo targets RingCentral; provided creds are Aircall/Twilio-shaped.

## What would prove these live

Register the redirect URIs (list in `INTEGRATION_STATUS.md`) behind a public
HTTPS origin, set `PUBLIC_API_BASE_URL`, then connect once per provider and
record the resulting connection row + account label.