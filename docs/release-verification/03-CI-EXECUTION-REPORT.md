# 03 — CI execution report

Status: **WORKFLOW HARDENED — VERIFIED (local); GitHub run BLOCKED on publication**

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

## What is still BLOCKED

A **GitHub Actions run cannot exist until the branch is pushed** (publication
awaits authorization — the same blocker as the audit). Exact steps once
authorized:

1. `git push -u origin feature/murmur-app-remediation`
2. Open the Actions tab → confirm all five jobs on the push run → record the run URL + SHA here.
3. Enable branch protection on `main` requiring the five checks (repo admin).
4. Optionally add Dependabot config (`versioning-strategy` for the three manifests) — dependabot branches already exist on origin, so the bot is enabled org-side.

Until step 1 happens, "CI verified on GitHub" remains **BLOCKED**; the workflow
file alone is not claimed as proof.
