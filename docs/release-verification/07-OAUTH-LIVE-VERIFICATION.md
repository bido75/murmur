# 07 — OAuth live verification

Status (2026-10-29): infrastructure and application side **VERIFIED with live
evidence**; per-provider consent round-trips remain **BLOCKED (operator:
provider consoles + a browser click-through)** — nothing is fabricated.

## The public origin is live

`https://notes.giscop.com` (Cloudflare Tunnel `murmur-app`, connector container
`cloudflared-notes`) serves the web app **and** the API on one origin
(path-based routing: `/rest|/auth|/storage|/functions` v1 → kong, everything
else → the web app). Verified: app 200, deep links 200, PostgREST/GoTrue/
Storage 200 with the anon key, functions answering their own auth errors.

## Sign-in codes: verified end to end through the public domain

1. `POST /auth/v1/otp` through `https://notes.giscop.com` → success.
2. Code delivered by **real SMTP** (giscop.com mailbox, `mail.giscop.com:587`
   STARTTLS; the earlier Cloudflare-proxy on `mail.giscop.com` — which cannot
   carry SMTP — was corrected to DNS-only). GoTrue logged status 200 with no
   SMTP errors; delivery confirmed by the operator.
3. Code verified through the domain → **session obtained** →
   `calendar/start` with the session returned **200** with a real
   `accounts.google.com` consent URL (this previously failed with 400: the
   functions' `APP_URL` still pointed at the LAN web server, so `return_to`
   validation rejected the live origin — fixed).
4. The fallback link inside the sign-in email now points at
   `https://notes.giscop.com/auth/v1/verify?...` (GoTrue `external_url` was
   localhost).
5. Mailpit remains the local-only catcher (not in the tunnel ingress, no DNS,
   unreachable via the domain) and a support fallback exists:
   `scripts/admin-recover.cjs` mints a one-time sign-in link for any email
   without touching their mailbox.

## OAuth callbacks: the real `UNAUTHORIZED_NO_AUTH_HEADER` root cause

Google's consent **did** redirect back correctly with `?code=…&state=…`. The
error came from the Supabase **edge runtime's JWT gate**, which rejects any
request without a Supabase Authorization header *before the function runs* —
the function code never had a chance to run. The fix: `verify_jwt = false` in
`supabase/config.toml` for the 17 functions that authenticate themselves
(`requireUser` on user paths, one-time `state` tokens on callbacks, webhook
signatures, CRON secrets).

**Verified over the domain, with no Authorization header:**
- Unknown state → the function's own "That sign-in link expired" page (the
  function executed).
- Valid state + fake code → state consumed (single-use enforced), token
  exchange attempted, **302** back to `https://notes.giscop.com/settings?connected=slack:failed`.

With a real Google `code`, the same path stores the tokens and redirects with
`connected=…:ok`. The state that failed earlier was consumed by the failed
attempt — Connect must be clicked again.

## Claude / ChatGPT MCP connector: registration verified

Claude connects to `https://notes.giscop.com/mcp` and performs OAuth 2.1 with
dynamic client registration. The web host must serve the MCP endpoint, both
discovery documents and token exchange on one origin (the map
`scripts/hosting-config.mjs` writes for Vercel). The static server now
implements that map as a reverse proxy to kong. Verified step-by-step over the
domain, replaying Claude's handshake:

1. `POST /mcp` unauthenticated → **401** with
   `WWW-Authenticate: Bearer resource_metadata="https://notes.giscop.com/.well-known/oauth-protected-resource/mcp"`.
2. That metadata → `{"resource":"https://notes.giscop.com/mcp","authorization_servers":["https://notes.giscop.com"],…}`.
3. `/.well-known/oauth-authorization-server` → full AS metadata
   (`registration_endpoint`, PKCE S256, `token_endpoint_auth_method: none`).
4. **Dynamic client registration** with Claude's exact payload
   (redirect `https://claude.ai/api/mcp/auth_callback`) →
   `{"client_id":"mcl_k12WuOG7g00pqal2-LOa2sZ3",…}` — registration **succeeded**.

## Provider console registration state

| Provider | Console URIs | Status |
|---|---|---|
| Google (one OAuth client for Calendar + Docs) | `…/functions/v1/calendar/callback`, `…/functions/v1/connect/callback`, `…/auth/callback/google` (optional, Supabase-Auth broker only) + JS origin | **Registered by the operator** (confirmed by the console listing shared 2026-10-29) |
| Slack | `…/functions/v1/connect/callback` | BLOCKED — Slack app console |
| Procore | `…/functions/v1/procore/callback` | BLOCKED — Procore developer portal |

Scopes are per integration and already correct in code: Calendar requests
`calendar.readonly`, Docs requests `drive.file` (app-created files only — no
`documents` scope needed), Slack/Procore per their functions.

## What remains BLOCKED

1. **BL-3** — rotate the exposed credentials (19 rows in the rotation
   checklist, now including the Cloudflare Global API key, scoped/tunnel
   tokens and the SMTP mailbox password). Still the P0 release blocker.
2. **BL-4b** — one live consent click-through per provider: Google is now
   executable by the operator (console registered + callbacks live); Slack and
   Procore need their console registration first. No round-trip has been
   performed yet — nothing is claimed.
3. Console registration for Slack and Procore (operator).