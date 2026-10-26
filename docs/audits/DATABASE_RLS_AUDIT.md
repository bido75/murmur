# Database, Supabase and RLS audit

## Migrations

15 migration files; the branch adds two, both **additive**:

| Migration | Contents | Risk |
|---|---|---|
| `20261025010000_user_prefs.sql` | 4 columns on `user_settings` (`consent_reminder`, `field_mode`, `default_template`, `my_state`) with defaults | None — additive, defaults match client defaults |
| `20261025020000_webhook_ssrf.sql` | `webhook_url_public(text)` function + CHECK constraint on `webhooks.url` | None — blocks only, changes no rows |

No destructive statements anywhere in the branch. Migration harness (`tests/harness.mjs`)
applies every `*.sql` in order onto a fresh PGlite — so the migrations are
executable in sequence, proven by the 77 passing DB tests.

## RLS coverage (verified by tests, not by reading policies alone)

77 database security tests exercise real users against real rows:
`outsider/teammate/owner/service_role` across recordings, transcripts, notes,
tasks, projects, teams, invites, API tokens, integration secrets, webhooks,
automations, topic alerts, consent requests, search RPCs, retention, account
deletion.

Specifically verified this audit:

- **Cross-user denials**: `select * from user_settings` as another user → 0 rows;
  write scoped to another user's id → silent no-op (asserted unchanged).
- **Secrets unreadable**: `select secret from integrations` fails for the owner
  (service-only), API tokens stored hashed.
- **New prefs isolated**: the `account preferences` test proves owner-only
  read/write of `consent_reminder`/`field_mode`/`default_template`/`my_state`.
- **Webhook SSRF constraint**: private/metadata/localhost/single-label/http URLs
  rejected at the database level.

## Storage

- `audio`, `photos`, `exports` buckets accessed through signed URLs; server-side
  generation now uses `publicApiBaseUrl()`-derived and `clientUrl()`-rewritten
  addresses (no `kong` leak).

## Gaps

- No automated **migration-reversal** (down) path exists anywhere in the repo —
  rollback is by restoring a DB dump. Documented as a deployment consideration.
- Production-data compatibility of the two new migrations is safe (additive with
  defaults) but has not been run against a copy of production (no production
  access).