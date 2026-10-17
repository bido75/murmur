# Incident response

## Severity

| Level | Examples | Response |
|---|---|---|
| SEV1 | Confirmed unauthorized access to customer data; secrets leaked; RLS bypass | Immediately, around the clock |
| SEV2 | Suspected access; outage of recording uploads or processing > 1 h | Within 4 hours |
| SEV3 | Single-feature failure, vulnerability with no known exploitation | Next business day |

## Steps

1. **Detect & declare.** Anyone can declare. Open an incident channel and a running log (times in UTC).
2. **Contain.** Rotate affected secrets (Supabase service key, AI keys, OAuth secrets, Twilio,
   Recall, Resend webhook secrets); revoke tokens (`api_tokens`, `device_tokens`, `scim_tokens`);
   disable affected functions (`supabase functions delete` or remove the route); turn off public
   links for affected teams.
3. **Investigate.** Supabase logs (API, auth, functions, Postgres), `audit_events`, vendor logs.
   Preserve evidence before cleanup.
4. **Eradicate & recover.** Fix, add a regression test (DB policy tests for access bugs), redeploy.
5. **Notify.** Customers affected by a personal-data breach: without undue delay and within the
   contract's window (commonly 72 hours, GDPR Art. 33 for the controller). Include what happened,
   data involved, actions taken, and contacts. For PHI, follow the BAA and HIPAA breach rule.
6. **Review.** Blameless write-up within 5 business days: timeline, root cause, what helped, actions
   with owners and dates.

## Contacts

Fill in before production: incident lead, backup, legal contact, Supabase support plan, and each
vendor's security contact.
