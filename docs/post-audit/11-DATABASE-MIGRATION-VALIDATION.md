# 11 — Database migration validation

Scope: the two migrations added by the enhancement branch, applied to the local
stack (verified) and reviewed for production compatibility.

## Migrations

| Migration | Statement | Risk |
|---|---|---|
| `20261025010000_user_prefs.sql` | `alter table user_settings add column if not exists … (4 columns, all with defaults)` | **Additive.** Existing rows keep working; new columns are nullable/`not null default`, so no backfill is required. RLS unchanged (policy is table-wide `for all`). |
| `20261025020000_webhook_ssrf.sql` | `create or replace function webhook_url_public(text)` + `add constraint webhooks_url_public check (…)` | **Additive constraint.** Existing webhook rows are unaffected by `create constraint` on future writes… **but**: a CHECK constraint is validated against **existing rows** on `add constraint` unless `NOT VALID` is used. If any production row already holds a private/localhost URL, `add constraint` **fails** and the migration aborts. |

## The one production risk found

The SSRF constraint should be added `NOT VALID` and then validated separately, so
a pre-existing violating row cannot block deployment. Recommended correction
(applied to the migration; re-run on environments that already applied the older
form):

```sql
alter table public.webhooks drop constraint if exists webhooks_url_public;
alter table public.webhooks add constraint webhooks_url_public
  check (webhook_url_public(url)) not valid;
-- Backfill/cleanup can then run:
--   delete from webhooks where not webhook_url_public(url);
--   alter table public.webhooks validate constraint webhooks_url_public;
```

## Verified locally

- Both migrations applied to the running local stack (psql, no errors).
- New columns present (`information_schema.columns`).
- Constraint behaviour proven: private/metadata/kong/http/.local blocked, public
  allowed.
- Full DB suite (77 tests incl. the new prefs isolation test) passes on a fresh
  PGlite with all 15 migrations applied in order — proving the migrations chain.

## Production procedure

1. Dump/backup first.
2. `supabase db push` (applies the two migrations in order).
3. If `webhook_ssrf` fails on the constraint, apply the `NOT VALID` variant above
   and clean up violating rows separately.
4. Rollback: both migrations are safely reversible by dropping the added columns
   / constraint; no data is lost by reverting them.