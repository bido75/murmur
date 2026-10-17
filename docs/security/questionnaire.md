# Security questionnaire — pre-filled answers

Edit to match your deployment (region, plan, company policies) before sending.

**Where is data hosted?** Supabase on AWS in the region chosen at project creation (e.g. us-east-1).
Audio is processed by Deepgram and text by Anthropic in the US unless regional endpoints are configured.

**Is data encrypted at rest and in transit?** Yes. AES-256 at rest (Supabase); TLS 1.2+ in transit.

**How is customer data isolated?** Postgres row-level security on every table, tested automatically
as real users. Team admins cannot read members' personal recordings.

**Do you support SSO / SCIM?** Yes: SAML 2.0 SSO per verified domain, and SCIM 2.0 user provisioning.

**MFA?** Sign-in uses one-time email codes; with SSO, the customer's IdP enforces MFA.

**Audit logs?** Yes, tamper-resistant (database triggers, no user can edit or delete), visible to
team admins, exportable as CSV.

**Data retention and deletion?** Configurable per user and per team; automatic daily deletion;
account deletion and full data export are self-serve.

**Is customer data used to train AI models?** No. Deepgram's model-improvement program is opted out
on every request; Anthropic API inputs are not used for training under its commercial terms.

**Subprocessors?** See subprocessors.md.

**Penetration testing?** Not yet performed — schedule an external test before enterprise launch.

**SOC 2 / ISO 27001 / HIPAA?** Not yet audited. See soc2-readiness.md and hipaa.md for status.

**Incident response?** Documented (incident-response.md); customers notified without undue delay.

**Vulnerability disclosure?** Yes (vulnerability-disclosure.md).

**Recording consent?** In-app consent prompts with US state two-party-consent warnings, consent
links for attendees, announced notetaker bot and phone-call announcements; teams can require a
consent choice before recording.
