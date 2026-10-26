# CI/CD and deployment audit

## Current state

- **No CI/CD pipelines exist.** `.github/workflows/` is absent. Nothing enforces
  typecheck/lint/tests on push or PR.
- **No branch protection** evidenced (remote is present; branches never pushed).
- Deployment is documented in `README.md` and `docs/DEPLOYMENT.md`: `supabase db
  push`, `supabase secrets set …`, per-function `supabase functions deploy …`
  (with `--no-verify-jwt` only for provider-callback functions), Vercel for the
  web surface, EAS/dev-build for mobile.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| No CI | Regressions (like the `services.test.ts` Node-only failure that sat unnoticed) can land on main | Add a workflow: `tsc --noEmit`, `expo lint`, `npm test`, `deno check` + `deno test`, `desktop` typecheck/test |
| No branch protection | Direct pushes to main | Require PR + status checks |
| Secrets handled by hand | Exposure (see SEC-3) | `supabase secrets set` only from a secret manager |
| Migration ordering | Divergent environments | `supabase db push` from the repo as single source (already documented) |
| No rollback doc | Slow incident response | Point at DB dump restore + `git revert`; document RTO |

## Deployability of this branch

The branch is deployable by the documented process once pushed: migrations are
additive, new server env vars (`EXTERNAL_SUPABASE_URL`, `PUBLIC_API_BASE_URL`,
provider ids/secrets) are optional and degrade gracefully, and no existing
function contract changed in a breaking way. The desktop client needs the
handoff notes in `DESKTOP_INTEGRATION_HANDOFF.md` (settings now server-backed).