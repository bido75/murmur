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

## Trackers (Asana, Jira, Linear, Procore, monday, ClickUp, Trello)

These connect with a **user-pasted personal access token**, not a server-side
OAuth client. The only exception is Procore, which is OAuth:

| Provider | Status | Env / note |
|---|---|---|
| Procore | **Configured (sandbox)** | `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET`; set `PROCORE_LOGIN_URL`/`PROCORE_API_URL`/`PROCORE_APP_URL` to `https://sandbox.procore.com` |
| Asana, Jira, Linear, monday, ClickUp, Trello | User token | no server secret; the user pastes their own token in the app |

Redirect URI for Procore: `{EXTERNAL_SUPABASE_URL}/functions/v1/procore/callback`.

## Telephony

| Provider | Status |
|---|---|
| RingCentral | Not configured — the code targets RingCentral (`RINGCENTRAL_CLIENT_ID`/`SECRET`), but no credentials were provided. |
| Aircall import | Webhook-only; `AIRCALL_API_ID` / `AIRCALL_API_TOKEN` from the attachment do not map to a RingCentral-style connect. |
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