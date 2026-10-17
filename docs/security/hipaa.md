# HIPAA readiness

Murmur can be configured for covered entities and business associates, but **do not accept PHI
until every item below is done** and you have signed BAAs with customers.

## Required agreements

- **Supabase:** HIPAA add-on with a BAA (Team plan or above), and the project flagged as
  HIPAA in the dashboard (enables required settings).
- **Deepgram:** BAA (available on enterprise agreements).
- **Anthropic:** BAA for API use with the required configuration (zero data retention); confirm
  current eligibility with Anthropic.
- **Email (Resend or another provider):** BAA, or keep PHI out of emails (send links only).
- **Expo push:** keep PHI out of notification text (titles currently include recording titles —
  set the `PUSH_GENERIC_TEXT=1` function secret for PHI deployments).
- **Twilio** (if phone recording is used): BAA, HIPAA-eligible products only.
- **Recall.ai** (if the notetaker is used): BAA, or disable the notetaker for these customers.

Connected destinations (Slack, Notion, HubSpot, etc.) are under the customer's control; advise
customers to connect only BAA-covered tools.

## Product configuration for PHI customers

- Team policy: redaction **PHI** (and PII) on; audio retention set (e.g. 30 days).
- Team policy: public links **off** (or capped at 7 days with passwords).
- SSO required for the company domain; SCIM for deprovisioning.
- Audit log reviewed monthly by the customer admin.
- On-device transcription available for the most sensitive sessions (audio never leaves the phone).

## Technical safeguards in place

Access control (RLS, roles, SSO/SCIM), audit controls (trigger-based audit log), integrity
(quote-verified notes; immutable audit rows), transmission security (TLS), encryption at rest
(Supabase), automatic logoff (session expiry), unique user identification (per-user accounts).

## Gaps to close

Formal risk analysis; workforce
training; breach-notification procedure with timelines (incident-response.md).
