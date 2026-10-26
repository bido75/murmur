# 07 — CI/CD quality gates

Implemented: `.github/workflows/ci.yml` (committed `9540d62`).

## Pipeline

| Job | Steps |
|---|---|
| `app` | `npm ci` → `npx tsc --noEmit` → `npx expo lint` → `npm test` (185 logic + app units + 77 DB security on PGlite) |
| `functions` | `deno check .` → `deno test --allow-all _shared/` (185 tests) |
| `desktop` | `npm ci` (desktop lockfile) → `npx tsc --noEmit` → `npm test` |

## Hardening applied per the prompt

- **Least privilege**: `permissions: contents: read` on the workflow level.
- **Pinned actions**: `actions/checkout@v4`, `actions/setup-node@v4`,
  `denoland/setup-deno@v2`.
- **Lockfile installs**: `npm ci` (never `npm install`).
- **No secrets in CI**: the pipeline needs none — tests run on PGlite and local
  fixtures, so no privileged secrets are exposed to any job (including
  fork PRs).
- **Timeouts**: 15–30 min per job so hung steps cannot burn runners.
- **Isolated test databases**: the DB suite runs on in-process PGlite with
  migrations — no shared or hosted database touched.

## Branch protection (operator action, needs repo admin)

Recommend on GitHub once the branches are pushed:

- Require the three `ci` jobs to pass before merging.
- Require a pull request (no direct pushes to `main`).
- Disallow force pushes and deletions on `main`.
- Do not bypass the checks for any merge.

## What is not in CI (and why)

- **Live provider calls** — needs real credentials; must stay out of CI.
- **Physical-device runs** — needs hardware; separate device-lab job later.
- **Dependency scanning** — `npm audit --omit=dev` can be added as a fourth job;
  current state documented in `SECURITY_AUDIT.md` (8 advisories, all in Expo
  build tooling, none shipped in the bundle).