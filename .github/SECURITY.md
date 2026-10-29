# Security policy

## Reporting a vulnerability

Report vulnerabilities privately: use GitHub's
**Security → Report a vulnerability** (Private vulnerability reporting), or
email **security@giscop.com**.

Do not open a public issue for a security problem.

## Response targets

| Stage | Target |
|---|---|
| Acknowledgement | 24 hours |
| Initial assessment | 72 hours |
| Fix or mitigation | 30 days |

## Scope

In scope: this repository and the deployments listed in the README
(the public origin, the Supabase backend and its edge functions, the desktop
app). Out of scope: third-party services' own infrastructure.

## Safe harbour

Good-faith research and reporting is welcome. We ask that you avoid privacy
violations, destruction of data, and interruption of service, and give us a
reasonable time to fix issues before public disclosure.

## Controls in place

- Branch protection on `main` (no direct pushes, PR-only, required checks).
- CodeQL SAST (security-extended queries) on every change.
- Secret scanning + push protection (GitHub) plus a repo-owned secret scanner
  (`scripts/secret-scan.mjs`) and Gitleaks in CI.
- Dependency audit gates (`npm audit` at critical severity on three surfaces,
  `deno audit`) and weekly Trivy filesystem scans with SARIF results.
- Dependabot security updates enabled.
- Row-level security on every table, tested on real Postgres
  (`npm run test:db`).
- Webhook signature verification and CRON secrets on all provider endpoints.
- Credential rotation policy: see `docs/post-audit/05-CREDENTIAL-ROTATION-CHECKLIST.md`.
- Privacy/security documentation: `docs/security/`.
