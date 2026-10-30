# 14 — Desktop compatibility handoff (post-audit copy)

Authoritative file: `docs/DESKTOP_INTEGRATION_HANDOFF.md`. This audit verified
each point against the post-remediation source and adds the two contracts changed
during remediation.

## Contracts changed by the remediation

| Contract | Change | Desktop action required |
|---|---|---|
| **User settings** (account-level) | `consent_reminder`, `field_mode`, `default_template`, `my_state` now persist in `user_settings` and sync across devices | The desktop must read these from `user_settings` (it already has Supabase auth) and stop treating them as device-local |
| **Settings save semantics** | optimistic → commit/rollback; field mode never writes `default_template` | If the desktop has its own settings editor, it must apply the same rule (field mode is an override) |
| **Signed download URLs** | host-rewritten to `EXTERNAL_SUPABASE_URL` when set | No change if the desktop consumes server URLs; any desktop-built server URLs must apply the same rewrite |
| **OAuth redirect base** | `publicApiBaseUrl()` = `PUBLIC_API_BASE_URL` → `EXTERNAL_SUPABASE_URL` → `SUPABASE_URL` | Desktop OAuth flows inherit it; provider consoles must register the resulting redirect URIs |
| **Webhook destinations** | DB constraint rejects private hosts | Surface "address must be a public https URL" if the desktop edits webhooks |

## Verified unchanged

Recording IDs, transcript utterance shape, summaries schema, tasks schema,
project associations, storage buckets, processing API, auth — all untouched; the
desktop's existing sync, playback, dictation and build continue to work.

## Verified by test

- Desktop typecheck and 92 tests pass against the changed backend.
- Both new migrations are additive (desktop DB requires no action beyond
  applying them).

## Desktop-specific work explicitly deferred

Dictation UI polish, wake word (deliberately not built), CLI control, local HTTP
API, volume ducking, desktop model-folder permissions, packaging. See
`docs/MURMURE_INTEGRATION.md` and `docs/PRODUCTION_READINESS.md`.