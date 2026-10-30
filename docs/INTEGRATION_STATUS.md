# Integration status

Current wiring of the third-party providers, against the credentials available in
this environment. "Configured" means the server has the client ID/secret (or token)
and the Settings UI offers a real connect action; "live" additionally means it was
verified end to end here.

## Calendar

| Provider | Status | Env | Redirect URI to register |
|---|---|---|---|
| Google | **Configured, needs live callback test** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `{EXTERNAL_SUPABASE_URL}/functions/v1/calendar/callback` |
| Microsoft | Not configured | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | `{EXTERNAL_SUPABASE_URL}/functions/v1/calendar/callback` |

`/calendar/providers` reports `["google"]` (verified). Registered the redirect URI in
the Google Cloud console as `http://10.0.0.180:54325/functions/v1/calendar/callback`
for local testing. The Microsoft credentials were not provided (`MICROSOFT_TENANT`
defaults to `common`).

## Destinations (Slack, Google Docs, OneNote, Salesforce)

| Provider | Status | Env |
|---|---|---|
| Slack | **Configured** | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` |
| Google Docs | **Configured** | reuses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| OneNote | Not configured | `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` |
| Salesforce | Not configured | `SALESFORCE_CLIENT_ID` / `SALESFORCE_CLIENT_SECRET` |

`/connect/available` reports `["slack","google_docs"]` (verified). Redirect URI:
`{EXTERNAL_SUPABASE_URL}/functions/v1/connect/callback`.

## Trackers (Asana, Jira, Linear, Procore, monday, ClickUp, Trello, HubSpot)

These connect with a **user-pasted personal access token**, not a server-side
OAuth client. The only exception is Procore, which is OAuth:

| Provider | Status | Env / note |
|---|---|---|
| Procore | **Configured (sandbox)** | `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET`; set `PROCORE_LOGIN_URL`/`PROCORE_API_URL`/`PROCORE_APP_URL` to `https://sandbox.procore.com` |
| Asana, Jira, Linear, monday, ClickUp, Trello | User token | no server secret; the user pastes their own token in the app |
| HubSpot | User token | the user pastes a **private app access token** (the `pat-na2-...` value), not the OAuth client. Give the private app `crm.objects.contacts.read`, `crm.objects.notes.*` and tasks scopes. |

Redirect URI for Procore: `{EXTERNAL_SUPABASE_URL}/functions/v1/procore/callback`.

### HubSpot — the OAuth client does not map here

The `mcp-hubspot` OAuth 2.1 app (client id `88fcfa1f-…`) is for a **HubSpot MCP
install**, not for this codebase: its redirect is `https://notes.giscop.com/mcp`,
which this Supabase backend does not serve. Murmur connects HubSpot by private-app
token (`src/app/integrations.tsx`, `trackers.ts#hubspot` → `api.hubapi.com`). Do not
put the OAuth client id/secret in this backend's env — nothing reads them. Use the
private-app token in the app's Connections UI instead.

## Telephony

| Provider | Status |
|---|---|
| RingCentral | Not configured — the code targets RingCentral (`RINGCENTRAL_CLIENT_ID`/`SECRET`), but no credentials were provided. |
| Aircall import | Webhook-only; `AIRCALL_API_ID` / `AIRCALL_API_TOKEN` from the attachment do not map to a RingCentral-style connect. |

## Google: "device_id and device_name are required for private IP"

When connecting Google (Calendar or Google Docs) locally the redirect is
`http://10.0.0.180:54325/functions/v1/{calendar|connect}/callback`, a **private IP**.
Google rejects private-IP redirects unless the client is explicitly an
out-of-band/loopback app that sends `device_id`/`device_name` — this backend does
not do that, so the correct fix is to give Google a **public, HTTPS redirect**.

Two ways:

1. **(Recommended) Put a public HTTPS name in front of the local server**, e.g. a
   `cloudflared` quick tunnel, and set `EXTERNAL_SUPABASE_URL` to that host. Then add
   `https://<tunnel>/functions/v1/calendar/callback` **and**
   `https://<tunnel>/functions/v1/connect/callback` to the Google Cloud console →
   Credentials → the OAuth client → Authorized redirect URIs.
2. Test the real OAuth flow against the deployed `notes.giscop.com` backend instead
   of localhost, with those production redirect URIs registered.

The `device_id and device_name` message is Google's way of saying "this redirect
isn't authorized for this client" — the code is correct; the console redirect list
is the thing that is wrong.
| Twilio (`PHONE_PROVIDER_*`) | No Twilio integration exists in this codebase. |

## What is not wired, and why

The attached `env_murmur.md` is for a **different backend** (Prisma/Postgres +
Node/Express on `notes.giscop.com`). Its OAuth client IDs/secret pairs for Notion,
Atlassian, Asana, Linear, monday, ClickUp and Trello describe app-level OAuth
clients with production redirect URIs, but this repository connects those
providers by **user-pasted token** — there is no server-side client-secret store
for them. Wiring them would mean building a new OAuth-client registry (the "Layer
1/Layer 2" architecture), not a local best-fit change. That is tracked as a
separate piece of work.

Also: every one of these credentials was pasted into a chat, so **all of them
should be rotated** before any production use.