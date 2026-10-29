# 03 — CI execution report

Status: **VERIFIED — passing GitHub Actions run on this branch** (2026-10-28)

- Run: https://github.com/bido75/murmur/actions/runs/40749378217 (`ci`, push event)
- Commit: `5b27effc63242142032e872ddd36bedf06d63cc7` ("CI fix: secret-scan diff mode resolves origin/main on CI checkouts")
- Result: **success — all five jobs passed**

| Job | Duration | Conclusion |
|---|---|---|
| app (tsc, lint, tests, iOS Metro bundle build) | 1m53s | ✓ |
| security (secret scan tree+diff, npm audits root/desktop/zapier, critical gates, artifacts) | 34s | ✓ |
| db-security (92 RLS/authorization tests on PGlite with real migrations) | 1m35s | ✓ |
| functions (deno check, tests, dependency audit) | 16s | ✓ |
| desktop (tsc, tests) | 17s | ✓ |

## Final run (2026-10-29, after the release-verification refresh)

- Run: https://github.com/bido75/murmur/actions/runs/40833586419 (`ci`, pull_request)
- Commit: `8e28287` (release-verification refresh) — success, all five jobs.

## Latest run (2026-10-29, after the live-domain + onboarding work)

- Run: https://github.com/bido75/murmur/actions/runs/40829899080 (`ci`, pull_request)
- Commit: `a50565d` — all five jobs passed (app 2m21s, db-security 1m39s, functions 13s, security 40s, desktop 19s).

Two intermediate failures were caught and fixed by CI itself, which is the gate
doing its job:

1. Run 40748762455 — `git merge-base main` fails on CI checkouts (only
   `origin/main` exists there). Fixed in `scripts/secret-scan.mjs`.
2. Runs 40824797373 / 40829147901 — `npm ci` refused the tree:
   `npx expo install --fix` (dev-server fix) had bumped `package.json` without
   the lockfile following. The aligned `package-lock.json` is now committed
   (`a50565d`), and the run above is green.

First run (40748762455) failed exactly as a real CI run should surface things:
`git merge-base main HEAD` failed on the runner (only `origin/main` exists
there). Fixed in `scripts/secret-scan.mjs` (origin/main with main fallback,
commit `5b27eff`), re-run green. The draft PR (#15) carries the required checks.

## What the workflow now contains (`.github/workflows/ci.yml`)

| Job | Steps | Notes |
|---|---|---|
| `app` | npm ci → tsc → expo lint → npm test → `expo export --platform ios` (Metro bundle artifact) | build verification included |
| `db-security` | npm ci → `npm run test:db` | 92 RLS/authorization tests on in-process PGlite with the real migrations — no DB service needed |
| `functions` | deno check → deno test → `deno audit --level critical --frozen-lockfile` | dependency scanning for the Deno surface |
| `desktop` | npm ci → tsc → npm test | |
| `security` | repo-owned secret scan (tree + merge-base diff) → npm audits (root/desktop/zapier) → **critical-severity gates** → audit JSONs uploaded as artifacts (30-day retention) | no secrets provided to any job |

Hardening applied: third-party actions pinned to **commit SHAs** (checkout
v7.0.1 `3d3c42e5…`, setup-node v7.1.0 `949feb24…`, setup-deno v2.0.5
`22d081ff…`, upload-artifact v7.0.1 `043fb46d…`), `permissions: contents: read`,
concurrency cancel, YAML parse-validated. The secret scanner is repo-owned
(`scripts/secret-scan.mjs`) with redacted output and a negative test
(planted fake key → exit 1).

## Locally verified gates (exact commands, 2026-10-28)

| Command | Result |
|---|---|
| `node scripts/secret-scan.mjs` / `--diff` | clean / clean |
| `npm audit --omit=dev --audit-level=critical` | exit 0 |
| `npm audit --audit-level=critical` (desktop, zapier) | exit 0 / exit 0 |
| `deno audit --level critical --frozen-lockfile` | exit 0 (2 high findings mitigated, see 04) |
| `node --test supabase/tests/*.test.mjs` (what `test:db` runs) | 92 pass / 0 fail |
| `npx expo export --platform ios` | previously verified this sprint (4.2 MB bundle) |

## What is still open (repo admin, optional hardening)

1. Enable branch protection on `main` requiring the five CI checks (owner).
2. Optionally add a Dependabot config for the three manifests (dependabot branches already exist on origin, so the bot is enabled org-side).

The "CI not verified on GitHub" blocker (BL-15) is **closed**: the exact run URL
and SHA are recorded above.
