# Desktop integration handoff

The Electron desktop app is not rebuilt in this phase, but the web/mobile app and
the backend changed under it. These are the contacts the desktop client must keep
working with, so it can adopt them without a rewrite.

## What changed

### 1. Account-wide user settings moved to the server

New columns on `public.user_settings` (all default, additive):

| Column | Type | Meaning |
|---|---|---|
| `consent_reminder` | boolean | show the consent notice before recording |
| `field_mode` | boolean | gloves-friendly UI; default type becomes site walk |
| `default_template` | text | the user's canonical default recording type |
| `my_state` | text | consent/location code |

The desktop must read these from `user_settings` (it already has Supabase auth) and
stop keeping them only in its local store, so a preference set on the phone shows on
the desktop and vice versa. `field_mode` is an override; `default_template` is the
saved preference — turning field mode off must restore whichever the user chose.

### 2. Signed download URLs are host-rewritten

Storage-signed URLs returned by `make-deck`, `share` and `export-data` now pass
through `clientUrl()`, which swaps the Docker-internal `kong` host for
`EXTERNAL_SUPABASE_URL` when it is set. The desktop downloads these same URLs; no
change is required, but if it ever builds its own signed URLs server-side it must
apply the same rewrite or its download links will fail on a local stack.

### 3. OAuth callback URLs

`calendar`, `connect` and `procore` now build their redirect URIs from
`EXTERNAL_SUPABASE_URL` (falling back to `SUPABASE_URL`). The desktop's calendar and
connection flows go through these same functions, so nothing changes for it — but
the OAuth client redirect URIs registered with Google/Slack/Procore must now match
`{EXTERNAL_SUPABASE_URL}/functions/v1/{calendar|connect|procore}/callback`.

### 4. Speech engine fallback (server only)

`transcribe()` now tries the configured engine and falls back to the other one, with
retry on transient network errors. The desktop's on-device Parakeet path is
untouched; this only affects server-side transcription.

### 5. Webhook SSRF hardening

`public.webhooks.url` now has a check that rejects private/reserved hosts. If the
desktop offers a webhook-destination editor, it should surface this as "address must
be a public https URL".

## What the desktop must not do

- Do not write `default_template` when toggling field mode (it must only read the
  effective value).
- Do not assume `SUPABASE_URL` is the public address for OAuth redirects on a local
  stack — use `EXTERNAL_SUPABASE_URL`.

## Shared contracts unchanged

Recording IDs, transcript utterance shape (`{ start_ms, end_ms, speaker, text }`),
the summaries schema, task rows, project associations and the processing API are all
unchanged. The desktop's existing sync, playback and dictation continue to work
against the same tables and functions.

## Migration requirement

Apply `supabase/migrations/20261025010000_user_prefs.sql` and
`20261025020000_webhook_ssrf.sql` to any environment the desktop points at. Both are
additive and backward-compatible.