# Murmur security & compliance pack

Documents to answer customer security reviews and to run the service safely. They describe what
the code does today. **Status:** Murmur has not had a SOC 2 audit or a HIPAA assessment. These
documents prepare for both; they are not a claim of either.

| Document | For |
|---|---|
| [overview.md](overview.md) | Architecture, data flow, encryption, tenant isolation |
| [access-control.md](access-control.md) | Roles, row-level security, admin console, audit log, SSO, SCIM, tokens |
| [data-retention.md](data-retention.md) | What is stored, for how long, deletion and export |
| [subprocessors.md](subprocessors.md) | Every outside service and what it receives |
| [incident-response.md](incident-response.md) | Severity levels, steps, customer notice |
| [vulnerability-disclosure.md](vulnerability-disclosure.md) | How researchers report issues; `security.txt` |
| [soc2-readiness.md](soc2-readiness.md) | Trust Services Criteria mapped to built controls and open process work |
| [hipaa.md](hipaa.md) | What must be true before handling PHI; configuration checklist |
| [dpa-template.md](dpa-template.md) | Data Processing Agreement outline (GDPR / UK GDPR / CCPA) |
| [sso.md](sso.md) | Operator steps for SAML SSO and SCIM |
| [questionnaire.md](questionnaire.md) | Pre-filled answers to common security-questionnaire questions |

Keep these in step with the code: when a feature that touches data ships, update the matching page
(and `subprocessors.md` if a new service is involved).
