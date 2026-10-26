# Backend / API audit

All server logic lives in Supabase Edge Functions (`supabase/functions/*`) with
shared logic in `_shared/` (pure, tested under Node **and** Deno).

## Authorization model

- Functions exposed to providers (`--no-verify-jwt` deployed): only the provider
  callback/webhook routes; every other route calls `requireUser(req)`.
- `requireUser` builds a **user-scoped Supabase client** carrying the caller's
  JWT, so all data access goes through RLS — ownership is enforced by the
  database, not by handlers trusting client-supplied ids.
- Admin (service-role) client is used only for cross-user writes after an
  explicit ownership check, and for retention/cleanup.
- Verified: `ask`, `notes-provider`, `translate`, `calendar`, `connect`,
  `procore`, `process-recording`, `make-deck`, `share`, `export-data` all gate on
  `requireUser`.

## Validation and safety

- Input validation: language/`lang` against the canonical list; webhook URLs by
  DB constraint + SSRF layers; upload content-types by allowlist; automation
  actions JSON-schema-checked in the DB; consent methods enum-checked.
- SSRF: webhook destinations blocked at DB + fetch time (see SECURITY_FINDINGS).
- Provider responses validated (`check()` helper in `trackers.ts`, explicit
  `res.ok` handling in calendar/oauth paths) with user-facing errors that do not
  leak internals beyond the provider's own message.
- Timeouts: outbound calls carry `AbortSignal.timeout` (STT, LLM, webhook
  delivery 10s).

## Reliability

- Transcription: engine fallback + 3-attempt retry on transient network errors
  (unit-tested order logic; fallback exercised for real during a DNS outage).
- LLM: provider choice with timeout, JSON extraction tolerant of fenced/prefixed
  output.
- Jobs: `after_ready` steps are independent; a failure marks that webhook or
  automation, never the recording.
- Idempotency: segment transcripts cached by content-key; re-running notes does
  not duplicate tasks (`dropRepeats`).

## Gaps

- **Rate limiting** is not implemented on app-invoked endpoints (RLS prevents
  data abuse but not request floods). Backlog candidate.
- **Webhook retry/backoff**: only the last attempt is recorded (FIND-009).
- **No CI** to enforce these checks on merge (SEC-5).

## Contract consistency

`callFn` on the client unwraps `{ error }` bodies; functions return
`json({ error }, status)` consistently; `HttpError` carries the status. Verified
across the functions touched this branch.