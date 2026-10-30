# 04 — Security remediation

Every security finding from the independent audit, with its verification state
after the post-audit remediation. Each claim is backed by an executed command or
a cited file; nothing is accepted from a prior report alone.

## SEC-1 — Webhook SSRF (was HIGH, now RESOLVED)

A webhook destination URL only had to start with `https://`, so the server could
be made to fetch `https://127.0.0.1/…`, the cloud metadata service
(`https://169.254.169.254/…`), or anything else on the internal network.

**Remediation, three layers:**

1. `_shared/ssrf.ts` — host classification blocking private/reserved IPv4 ranges
   (loopback, RFC 1918, link-local/metadata, CGN, TEST-NETs, multicast),
   IPv4-mapped IPv6, ULA/link-local IPv6, `localhost`, single-label names and
   `.local`/`.internal` suffixes. 7 unit tests.
2. `_shared/after_ready.ts#deliver` — re-checks before fetching: parses the URL,
   rejects a private host literally, then **resolves DNS** and rejects any
   resolved address that is private (DNS-rebinding defence).
3. `20261025020000_webhook_ssrf.sql` — `webhook_url_public(url)` SQL function +
   CHECK constraint on `webhooks.url`, blocking direct PostgREST inserts.

**Verification:**

- `deno test _shared/ssrf.test.ts` — 7/7.
- `node --test supabase/tests/connections.test.mjs` — includes the SSRF test
  (private hosts rejected as a signed-in user through the real table).
- Direct SQL: `webhook_url_public('https://127.0.0.1/x')` = false,
  `('https://169.254.169.254/latest')` = false, `('https://kong/x')` = false,
  `('https://foo.local/x')` = false, `('http://example.com/x')` = false,
  `('https://hooks.example.com/x')` = true.

**Deployment-safety correction found during this remediation:** the original
migration added the constraint as a validated one, which would **abort deployment
if any pre-existing webhook row held a private URL**. The constraint is now added
`NOT VALID` with a documented cleanup-then-validate path
(`20261025020000_webhook_ssrf.sql`).

## SEC-2 — Internal `kong` hostname in public URLs (was HIGH, now RESOLVED)

Three separate leaks were closed:

1. **Signed download URLs** (decks, exports, shares) carried
   `http://kong:8000/…` — fixed by `clientUrl()` → `rewriteHost()` with the
   `EXTERNAL_SUPABASE_URL` override (pure logic unit-tested, real-run verified).
2. **OAuth redirect URIs** (calendar, connect, procore) built from `SUPABASE_URL`
   — fixed by `publicApiBaseUrl()`, which prefers `PUBLIC_API_BASE_URL` →
   `EXTERNAL_SUPABASE_URL` → `SUPABASE_URL`.
3. The Google rejection (`device_id and device_name are required for private IP`)
   was a direct consequence of 2 and is resolved by the same fix **plus** console
   registration of the new redirect URIs (operator action; see 06).

## SEC-3 — Credentials exposed in chat (CRITICAL, OPEN — operator)

Every provider credential pasted into this engagement (Google, Slack, Notion,
Atlassian, Asana, Linear, monday, ClickUp, Trello, Procore, HubSpot, Deepgram,
OpenRouter, Mistral, Anthropic, Aircall) must be treated as compromised.

**Verified clean in the repository:** `git grep` for every exposed secret shape
returns only documentation placeholders; `.env`, `.env.local` and
`supabase/functions/.env` are gitignored (`git check-ignore` confirms); the
client bundle was searched and contains no key material.

**Rotation:** the full per-provider checklist with consoles, rotation procedure
and revocation verification is `docs/post-audit/05-CREDENTIAL-ROTATION-CHECKLIST.md`
(15 credential sets). Rotation is an operator action — the coding environment
cannot access the provider consoles. **The release stays CONDITIONAL until every
credential is rotated and the old values are verified revoked.**

## SEC-4 — Google private-IP redirect (MEDIUM, OPEN — operator)

Google rejects `http://10.0.0.180:54325/functions/v1/connect/callback` with
`device_id and device_name are required for private IP` (400 invalid_request).
Root cause: the redirect URI is a private IP that is not registered for this
OAuth client; Google requires a public HTTPS redirect for web clients. The code
is correct — `publicApiBaseUrl()` now lets the operator point the redirect at a
tunnel or the deployed domain. Fix and registration steps:
`docs/post-audit/06-OAUTH-DEPLOYMENT-CONFIGURATION.md`.

## SEC-5 — No CI security gates (was MEDIUM, now RESOLVED)

`.github/workflows/ci.yml` now runs typecheck, lint, the full app suite (incl.
77 DB security tests), the Deno server suite and the desktop suite on every push
and PR, with least-privilege permissions, pinned actions, lockfile installs and
no secrets exposed to any job. Branch-protection recommendations are in
`docs/post-audit/07-CI-CD-QUALITY-GATES.md` (needs repo admin).

## What was re-verified as already correct

| Control | Method | Result |
|---|---|---|
| No cross-user data access | 77 DB security tests (outsider/teammate/owner) | enforced by RLS |
| No client-side service-role key | source + bundle inspection | PASS |
| Settings isolation (new columns) | account-preferences DB test | PASS |
| Webhook HMAC signing | `signWebhook` over the body, `X-Murmur-Signature` | unit-tested |
| Inbound webhook signatures | Stripe / Recall / Twilio / Aircall verification | unit-tested |
| OAuth state single-use + expiry | `cs_`/`cn_` tokens deleted on use | source-verified |
| Upload content-type allowlist | `uploadType()` mapping | unit-tested |
| Retention enforcement | `retention_due()` service-only | DB-tested |
| AI authorization + citations | `ask` RLS client + mandated citations | source-verified |
| Committed secrets | `git grep` scan | none (placeholders only) |

## Remaining open items

| ID | Severity | Item | Owner |
|---|---|---|---|
| SEC-3 | CRITICAL (process) | Rotate 15 credential sets | operator |
| SEC-4 | MEDIUM | Register Google redirect on a public origin; live round-trip | operator |
| — | LOW | Add `npm audit` as a CI job | developer |
| — | LOW | Physical-device security checks (keychain, permissions) | operator |