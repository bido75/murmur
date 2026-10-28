# 08 — Migration rehearsal

Status: **VERIFIED** (11 automated tests, `supabase/tests/migration-rehearsal.test.mjs`, running on in-process Postgres with the real migrations)

## Method

The rehearsal reproduces what a real deployment meets: an existing database with
legacy data, then the new migrations applied in deployment order. The harness
applies all migrations **except the two new ones**, seeds sanitized legacy data,
then applies `20261025010000_user_prefs.sql` and
`20261025020000_webhook_ssrf.sql`.

Seeded legacy data: 2 users, a project, a recording, transcript, summary/notes,
a task, **three webhook rows including a private-LAN URL
(`https://192.168.1.50/hook`) and the cloud metadata URL
(`https://169.254.169.254/latest/meta-data`)**, an integration row, a workspace
with a member.

## Verified claims (each a passing assertion)

| Claim | Test |
|---|---|
| Both migrations apply in order without aborting | `deploy: the two new migrations apply…` |
| **No data loss or rewrite**: all seeded rows survive with original content | `legacy data is preserved` |
| **NOT VALID semantics**: pre-existing private URLs survive untouched; the constraint is deliberately unvalidated | `NOT VALID semantics` |
| The violating rows are enumerable for the operator (cleanup list query) | `the violating rows are enumerable` |
| New rows are checked: private / metadata / kong / single-label URLs rejected; public accepted | `new rows are checked` |
| **Updates are also checked**: a legacy private webhook is frozen until its URL is fixed | `an UPDATE also re-checks` |
| Documented cleanup path: fix URLs → `ALTER TABLE … VALIDATE CONSTRAINT` succeeds; zero violating rows remain; constraint now validated | `the documented cleanup path works` |
| RLS intact: an outsider sees none of the legacy recordings/webhooks; the owner still sees theirs | `RLS still holds` |
| No other constraint (FK/PK/unique/check) left unvalidated | `all constraints validated` |

## Operator runbook derived from the rehearsal

1. Deploy the migrations — they cannot fail on legacy data (proven).
2. Run the cleanup query (`select url from webhooks where not
   webhook_url_public(url)`) — enumerate, do **not** silently rewrite rows.
3. Contact each webhook owner, fix their destination URL.
4. `alter table public.webhooks validate constraint webhooks_url_public;`
5. Until step 4, those webhooks are frozen (updates rejected) — intentional.

Also in the DB suite: `stale-processing.test.mjs` (4 tests) verifies the
companion sweep migration (`20261025030000_stale_processing.sql`): recordings
stuck in transient states >2 h are failed with a clear error; recent ones and
finished ones are untouched.

**No destructive experiment touched production or the shared local data**; the
rehearsal runs on an isolated in-process database.
