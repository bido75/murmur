# 06 — Credential rotation status

Status: **BLOCKED (operator)** — unchanged by this sprint by design; the
engineering environment cannot access provider consoles.

## Why this cannot be marked done here

Rotation requires: creating replacement credentials in each provider console,
verifying them in the deployment's secret store, then revoking the old values.
None of these surfaces is accessible from this environment, and rotating
production credentials without the owner present would itself be unsafe. What
engineering has done and verified:

| Engineering item | Evidence |
|---|---|
| No real secret committed (tree or history) | `scripts/secret-scan.mjs` clean on tree + merge-base→HEAD diff; negative test proves the scanner catches planted keys |
| Only `.env.example` (placeholders) tracked | `git ls-files` |
| Runtime secret files gitignored | `git check-ignore .env .env.local supabase/functions/.env` |
| Per-provider rotation checklist with consoles, procedures and revocation verification | `docs/post-audit/05-CREDENTIAL-ROTATION-CHECKLIST.md` (15 credential sets) |
| Findings doc separating code vs process risk | `docs/post-audit/04-SECURITY-REMEDIATION.md` (SEC-3) |

## Operator procedure (unchanged, one page)

Work the checklist top-to-bottom: create the replacement first, update the
authorized secret location, verify the replacement works, **then** revoke the
old value, then check the provider's usage logs for unexpected activity during
the exposure window. The release rule stands: **any confirmed-compromised
credential that is still active is a production release blocker** (SEC-3, P0).
