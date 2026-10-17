# Security overview

## Architecture

- **Clients:** iOS/Android/web app (Expo), desktop app (Electron), browser extension, Apple Watch
  and Wear OS recorders. Clients hold only the project's *publishable* key and the user's session.
- **Backend:** Supabase — Postgres (with row-level security on every table), Auth, Storage and
  Edge Functions (Deno). All server-side secrets (AI keys, OAuth client secrets, Twilio, Recall,
  Resend) live in Supabase function secrets; none ship in any client.
- **Processing:** audio → speech-to-text (Deepgram) → notes and tasks (Anthropic Claude) → stored
  in Postgres. Every task, decision and site-log item is checked against a verbatim quote from the
  transcript before it is shown as confirmed.

## Data flow

1. A client records audio in 5-minute parts and uploads each part to a private Storage bucket
   (`audio/<user_id>/<recording_id>/…`) over TLS. Parts are kept on the device until the upload
   is confirmed.
2. The `process-recording` function creates a short-lived signed URL for each part and sends it to
   Deepgram. Deepgram's model-improvement program is opted out (`mip_opt_out=true`) on every request.
   Optional redaction (PII, PHI, card numbers) is applied by Deepgram before the transcript returns.
3. The transcript is sent to Anthropic's API to produce structured notes. Anthropic does not train
   on API inputs by default (verify the current commercial terms).
4. Results are stored in Postgres. Webhooks, automations and exports run only for destinations the
   user connected.

On-device transcription (iOS, optional) keeps audio on the phone; only the text is uploaded.

## Encryption

- In transit: TLS 1.2+ for every client and service call (Supabase, Deepgram, Anthropic and all
  integrations are HTTPS-only; webhook targets must be `https://`).
- At rest: Supabase encrypts Postgres and Storage at rest (AES-256, provider-managed keys).
- Secrets in the database: integration tokens are stored server-side and are not readable by the
  app (column-level grants). API, device and SCIM tokens are stored only as SHA-256 hashes. Share
  link passwords and phone PINs are bcrypt-hashed.

## Tenant isolation

Every table has row-level security. Access is decided in the database, not in client code:
recordings are readable by their creator and by members of the team that owns their project;
personal recordings are visible to no one else, including team admins. Server functions that act
on a user's behalf use that user's session so the same rules apply; service-role access is limited
to background jobs and is never exposed to clients. The policies are covered by automated tests
that run as real users against the real migrations (`supabase/tests`).

## Public surfaces

- Share links: unguessable 144-bit tokens, optional password, expiry, revocable; teams can cap or
  disable them. Shared pages show only confirmed content.
- Webhooks in (Recall, Twilio, Aircall) are verified by signature or shared token.
- The REST API and MCP server accept only personal API tokens or OAuth (PKCE) grants.

## Application security practices

- Dependencies pinned via lockfiles; TypeScript strict mode; lint in CI.
- Inputs validated server-side (UUIDs, URLs `https://` only, sizes, enums).
- Spreadsheet exports defuse formulas; HTML emails and pages escape user content.
- Toll-fraud guard on outbound calls (allowed country prefixes, premium numbers blocked).
