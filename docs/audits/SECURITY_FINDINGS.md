# Security findings

References: OWASP ASVS / API Top 10 used as checklists; every claim below is
backed by an executed command or a cited source file. No secrets printed.

## Confirmed findings

| ID | Severity | Finding | Evidence | State |
|---|---|---|---|---|
| SEC-1 | HIGH | Webhook destinations could point at private IPs / cloud metadata (SSRF) | Before: `webhooks.url check (url ~ '^https://')` only. Now: `_shared/ssrf.ts` (7 unit tests) + delivery-time DNS check in `after_ready.ts` + `webhook_url_public` CHECK constraint (verified by direct SQL: `127.0.0.1`, `169.254.169.254`, `kong`, `http://`, `.local` all blocked; public host allowed) + DB test | **FIXED** |
| SEC-2 | HIGH | Server-built URLs leaked the Docker-internal `kong` host to phones | `git diff` shows `publicApiBaseUrl()` and `clientUrl()` introduced; real-run proof: deck/docx/zip URLs return `10.0.0.180:54325` | **FIXED** |
| SEC-3 | CRITICAL (process) | Provider credentials pasted into chat, unrotated | Operational; no secret committed (see below) | **OPEN — rotate before deploy** |
| SEC-4 | MEDIUM | Google rejects the private-IP OAuth redirect (`device_id and device_name are required for private IP`) | Reproduced by the user; root cause is an unregistered redirect, not code | **OPEN — needs console + tunnel** |
| SEC-5 | LOW | No CI pipelines exist, so no automated security scanning gates merges | `ls .github/workflows` — none | **OPEN** |

## Verified clean

| Area | Method | Result |
|---|---|---|
| Committed secrets | `git grep -E "sk-ant-|sk-or-v1-|mstrl_|GOCSPX-|pat-na2-|…"` across the tree | Only doc placeholders (`sk-ant-...`); `.env`, `.env.local`, `supabase/functions/.env` gitignored (`git check-ignore` confirms) |
| Client-side service-role key | `src/lib/supabase.ts` / `api.ts` use anon key; service role only in Edge Functions | PASS |
| Broken object-level authorization | 77 DB tests as outsider/teammate/owner across every table incl. tokens, integrations, webhooks | All denials enforced by RLS, not UI |
| Prompt injection / AI data access | `ask` uses `requireUser` + RLS user client; citations mandated; no-evidence honesty mandated | PASS |
| Webhook signing | `X-Murmur-Signature` HMAC over the body (`signWebhook`), timeout 10s | Unit-tested |
| Inbound webhook verification | Stripe signature, Recall signature, Twilio signature, Aircall token — all verified server-side | Unit-tested |
| OAuth state validation | Random `cs_`/`cn_` tokens stored server-side with expiry, single-use (deleted on use) | Source-verified |
| File upload validation | `uploadType()` content-type allowlist; extension↔type mapping unit-tested | PASS |
| Retention / account deletion | `retention_due()` service-only; deletion blocked for last owner of a team | DB-tested |
| Dependency vulnerabilities | `npm audit --omit=dev`: app 8 (all in Expo build/lint tooling; bundle searched — 0 present); desktop 0 | Documented in SECURITY_AUDIT.md |

## Not verifiable here

- Runtime secret hygiene on a hosted provider (Supabase dashboard access needed).
- TLS/CDN configuration of any deployed domain.
- Physical-device keychain/keystore behavior.