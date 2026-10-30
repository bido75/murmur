# Desktop compatibility handoff (audit copy)

The full handoff lives at `docs/DESKTOP_INTEGRATION_HANDOFF.md` and is unchanged
by this audit; this file records the audit's verification of it.

## Verified compatibility points

| Contract | Status | Note |
|---|---|---|
| Auth (Supabase JWT) | unchanged | Desktop uses the same project + anon/publishable key |
| User settings | **changed — server-backed now** | Desktop must read `consent_reminder`/`field_mode`/`default_template`/`my_state` from `user_settings` and stop treating them as device-local |
| Recording IDs / transcript shape | unchanged | `{ start_ms, end_ms, speaker, text }` untouched |
| Processing APIs | unchanged | `process-recording` contract stable |
| Storage / signed URLs | **changed** | URLs returned by server are host-rewritten (`clientUrl`); desktop consuming them needs no change, but any desktop-built server URLs must apply the same rewrite |
| Tasks/projects schema | unchanged | — |
| Migrations | additive only | `user_prefs` + `webhook_ssrf` safe to apply |
| OAuth redirect base | **changed** | `publicApiBaseUrl()` precedence; desktop OAuth flows inherit it |

## Regression risks for the desktop

1. If the desktop keeps a local settings cache and does not adopt the server
   values, the two clients will disagree about consent reminder / default type.
2. Field-mode semantics: the desktop must not write `default_template` when
   toggling field mode (same rule as mobile).
3. On a local stack, any desktop OAuth or download path must use
   `EXTERNAL_SUPABASE_URL`/`PUBLIC_API_BASE_URL`, never the Docker-internal host.

## Licensing

No Murmure (AGPL) source is used by the web/mobile app; the desktop's local
transcription uses the CC BY 4.0 Parakeet weights with attribution shipped in the
app. See `docs/LICENSE_REVIEW.md` — legal sign-off remains outstanding and is a
release gate for any distribution that includes the desktop engine.