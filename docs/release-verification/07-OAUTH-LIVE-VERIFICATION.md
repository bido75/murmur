# 07 — OAuth live verification

Status: application side **VERIFIED (code-level, with evidence)**; live
round-trips **BLOCKED (operator: public origin + console registration)**

## Application-side checks (verified this sprint)

| Requirement | Evidence | Result |
|---|---|---|
| Callback/redirect URLs derive from a public origin | `publicApiBaseUrl()` in `supabase/functions/_shared/services.ts:27` — `PUBLIC_API_BASE_URL` → `EXTERNAL_SUPABASE_URL` → `SUPABASE_URL`; used by calendar/connect/procore redirect construction | VERIFIED (code + endpoints return the rewritten host) |
| No private-IP / internal `kong` URLs in callbacks or signed URLs | `clientUrl()` rewrite; real-run proof: deck/docx/zip URLs return `10.0.0.180:54325`, never `kong` (test-features.cjs) | VERIFIED |
| PKCE enforced | `oauth.ts:2` "every flow uses PKCE (S256)"; `pkceMatches` at L36; `code_challenge` required at L150 | VERIFIED (unit-tested) |
| State parameter carried through authorize/redirect | `oauth.ts` L129/L168 (state parsed and round-tripped) | VERIFIED (unit-tested, 6 oauth tests) |
| Provider scopes per provider | `oauth_providers.ts` (Slack, Salesforce, Google Docs `openid email …drive.file`, OneNote `…Notes.Create`) | VERIFIED (code) |
| Token storage server-side, refresh + TTL | connections rows + `refreshBody` + `REFRESH_TTL_S = 30d`; refresh exercised in `calendar_fetch` path | VERIFIED (code + unit tests) |
| Disconnect/revoke path | `disconnectCalendar` / connect disconnect flows (tested in the oauth DB tests) | VERIFIED |
| Provider availability endpoints | live local run: `/calendar/providers` → `["google"]`; `/connect/available` → `["slack","google_docs"]` | VERIFIED (2026-10-28 local run) |

## What remains BLOCKED and exactly why

1. **Public HTTPS origin** — Google rejects a private-IP redirect
   (`device_id and device_name are required for private IP`). Fix is
   operational: run a tunnel (cloudflared is already installed and running on
   this machine for other containers) or use the deployed domain, then set
   `PUBLIC_API_BASE_URL` in the functions environment.
2. **Console registration** — register the exact callback URIs in each provider
   console (Google Cloud Console, Slack app settings, Procore developer
   portal). The exact URIs, derived from the approved public origin, are
   enumerated in `docs/post-audit/06-OAUTH-DEPLOYMENT-CONFIGURATION.md`.
3. **Live round-trip per provider** — after 1+2: connect → consent → callback →
   token exchange → one real API operation → disconnect → reconnect, per
   provider (Google Calendar, Slack, Google Docs, Procore where configured).

No mock or partial success is claimed for step 3: **no live OAuth round-trip
has been executed**, because the prerequisites do not exist in this
environment.
