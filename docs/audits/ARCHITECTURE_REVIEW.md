# Architecture review

## Shape

- **Client**: Expo (SDK 58) React Native app (`src/`), Expo Router file-based
  routes, theme/UI shared components, `lib/` services.
- **Server**: Supabase Edge Functions (Deno) in `supabase/functions/`, pure shared
  logic in `_shared/` tested under Node *and* Deno (unusual and valuable).
- **Desktop**: separate Electron app (`desktop/`) sharing the same Supabase
  backend; not rebuilt in this phase.
- **Database**: Postgres + RLS, additive migrations, PGlite test harness.

## Strengths (preserved, worth protecting)

1. **One source of truth for business rules** — `_shared` modules are imported by
   the app (`src/lib/shared.ts` re-exports) and tested under both runtimes. The
   recording-types list, consent rules, provider registries and SSRF guard all
   live once.
2. **DB-enforced authorization** — ownership is RLS, not handler checks.
3. **Provider registries** (`PROVIDERS`, `OAUTH_PROVIDERS`, `trackers`) make
   adding a provider a data change, not a rewrite.
4. **Docs discipline** — feature audit, licensing review, provider docs, test
   results all maintained alongside code.

## Weaknesses / debt (measured, not stylistic)

| Issue | Where | Risk | Suggestion |
|---|---|---|---|
| `api.ts` is 2,191 lines | `src/lib/api.ts` | Every feature touches one file → merge conflicts, slow navigation | Split by domain (recordings, projects, settings, integrations) |
| No CI | repo-wide | Regressions unnoticed | Add the 5-step workflow |
| No rate limiting on app endpoints | functions | Abuse/flood | Supabase edge rate limiting or WAF |
| Webhook delivery is fire-once | `after_ready.ts` | Silent loss on transient outage | Delivery log + retry (backlog 6) |
| Mixed env naming | `APP_URL` vs `EXPO_PUBLIC_APP_URL` vs `PUBLIC_API_BASE_URL` | Config drift | Document one precedence table (partially done in services.ts) |
| 60 uncommitted reformat files | working tree | Review noise | Commit separately or discard |

## Dead code / duplication

- None found on the branch. `services.test.ts` was the only removal (replaced by
  a pure-module test because the original could not run under Node).
- Desktop shares no code with the web app except the backend contract — by
  design for this phase.

## Backward compatibility

Two migrations are additive; no RPC signature changed; new env vars are optional.
The desktop app keeps working, with the settings-persistence change as the one
behavioral difference (documented in the handoff).