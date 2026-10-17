# SOC 2 readiness (Trust Services Criteria: Security, Availability, Confidentiality)

"Built" = in the product today. "Process" = organizational work needed before a Type I audit; a
compliance-automation tool (Vanta, Drata, Secureframe) can track evidence for these.

| Criteria | Control | Status |
|---|---|---|
| CC1 Control environment | Security policies, code of conduct, background checks, security training | Process |
| CC2 Communication | Security page, this pack, customer notices of changes | Partly built (docs); publish a security page |
| CC3 Risk assessment | Annual risk assessment and vendor review (subprocessors.md) | Process |
| CC4 Monitoring | Alerting on function errors, failed jobs, auth anomalies | Process — wire Supabase log drains to an alerting tool |
| CC5 Control activities | Code review on every change; CI runs tests, types, lint (`.github/workflows/ci.yml`) | CI built; enforce branch protection and reviews (process) |
| CC6.1 Logical access | RLS on all tables; role model; tokens hashed; least-privilege service role | Built |
| CC6.1 Authentication | Email codes, SAML SSO, SCIM deprovisioning | Built (see SSO gap in access-control.md) |
| CC6.2/6.3 Access reviews | Quarterly review of Supabase org members, vendor consoles, team admins | Process |
| CC6.6 External threats | HTTPS only; signed webhooks; input validation; toll-fraud guard | Built |
| CC6.7 Data in transit | TLS everywhere | Built |
| CC6.8 Malware / changes | Dependency pinning, `npm audit` in CI, Dependabot | Process — enable Dependabot/Renovate |
| CC7.2 Event logging | Audit log (triggers), Supabase platform logs | Built (product); retain platform logs ≥ 1 year (process) |
| CC7.3–7.5 Incidents | incident-response.md; tabletop exercise yearly | Process |
| CC8 Change management | Migrations in git; tests for every policy; staged deploys | Partly built — add a staging project |
| CC9 Vendor risk | subprocessors.md; review SOC reports of Supabase, Deepgram, Anthropic, Twilio, Recall | Process |
| A1 Availability | Supabase backups/PITR; offline-safe recording queue on devices; status page | Partly built — enable PITR, publish status page |
| C1 Confidentiality | Retention controls, deletion, export, redaction | Built |

Suggested path: pick an automation tool → write policies from its templates → close the
"Process" rows → 3-month observation → Type II.
