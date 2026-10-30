# Security audit report — Murmur (giscop.com deployment)

Date: 2026-10-29
Scope: `bido75/murmur` (branch `feature/murmur-app-remediation`), the live
origin `https://notes.giscop.com`, and the Supabase backend behind it.
Method: white-box review of the codebase + black-box probing of the live
origin + automated scanning (CodeQL SAST, Trivy CVE/secret/misconfig,
Gitleaks, `npm audit` ×3 surfaces, `deno audit`, 97 Postgres RLS tests,
repo-owned secret scanner, GitHub secret scanning with push protection).

Verdict summary: **no critical findings open**; 1 high finding mitigated
in the application layer; 3 dev-time-only dependency findings risk-accepted;
all identified gaps have fixes either shipped or documented with owners.

## Findings

| # | Severity | Finding | State |
|---|---|---|---|
| F-01 | CRITICAL → RESOLVED | Webhook SSRF: provider callbacks could target private IPs / the cloud metadata service | Fixed in three layers (`_shared/ssrf.ts` 7 tests, delivery-time DNS re-check, `webhook_url_public` SQL constraint with safe NOT VALID rollout) |
| F-02 | HIGH → RESOLVED | Server-built URLs leaked the internal `kong` host to phones and browsers | `publicApiBaseUrl()` + `clientUrl()` rewrite; all public URLs verified non-kong |
| F-03 | HIGH → RESOLVED | Edge runtime's default JWT gate blocked every provider OAuth callback (`UNAUTHORIZED_NO_AUTH_HEADER`), which would have pushed adopters toward disabling auth wholesale | Per-function `verify_jwt = false` for the 17 self-authing functions only; all user-initiated paths still enforce `requireUser` |
| F-04 | HIGH → MITIGATED | `image-size` 1.2.1 unbounded-loop parsers (ICNS/JXL/HEIF) reachable via user photos in generated decks; no upstream fix exists | Application-layer guard: `_shared/imageGuard.ts` magic-byte allowlist (JPEG/PNG only) before embedding; 4 unit tests; residual risk limited to JPEG/PNG parsing |
| F-05 | MEDIUM → RESOLVED | Sign-in email carried a localhost fallback link (unusable outside the machine) | GoTrue `external_url` set to the public origin; verified in a delivered email |
| F-06 | MEDIUM → RESOLVED | Live origin served **no security headers** (no HSTS, nosniff, frame protection, referrer or permissions policy) | All headers now sent on every static response; CSP deployed report-only until the app's inline/style sources are audited, then enforced |
| F-07 | MEDIUM → RESOLVED | `mail.giscop.com` was Cloudflare-proxied — a proxied mail host cannot carry SMTP, breaking delivery paths that depend on it | Zone record corrected to DNS-only; SMTP verified (STARTTLS on 587, authenticated delivery confirmed) |
| F-08 | MEDIUM → RESOLVED | Edge-function unbounded notes prompt: a very long transcript could kill the processing worker and leave recordings stuck forever | 120K-char transcript cap with a visible truncation marker + `fail_stale_processing()` daily sweep (migration + 4 DB tests) |
| F-09 | HIGH (process) → OPEN | Credentials pasted into chat during development: 19 credential sets including the Cloudflare Global API key and a full-scope GitHub PAT | Rotation checklist `docs/post-audit/05-CREDENTIAL-ROTATION-CHECKLIST.md` (19 rows); **operator action; P0 release blocker until complete** |
| F-10 | MEDIUM (process) → OPEN | One live consent click-through per provider has not been executed by a human yet | Google console URIs registered; Google is executable by the operator now; Slack/Procore consoles pending |
| F-11 | LOW → RISK-ACCEPTED | `zod` <4.6.6, `deepmerge` ≤4.3.1, `@expo/cli` advisory cluster | Build/lint-time only, no runtime reachability; no compatible fix exists (npm's proposed fix is a two-major Expo downgrade — rejected) |
| F-12 | LOW → RESOLVED | Two trailing-whitespace defects flagged by `git diff --check` | Fixed; `git diff --check main...HEAD` now exits 0 |

## Controls verified live (attacker-view probes)

- Every sensitive-looking path (`/.env`, `/.git/config`, `/config.toml`,
  `/admin`, …) returns the same 1368-byte application shell — no file or
  configuration leakage from the static host.
- MCP endpoint returns 401 + a resource-metadata hint for unauthenticated
  calls; personal API tokens (`mur_…`) are hash-stored, revocable, and scoped
  to exactly what the owner can see (RLS-tested).
- OAuth flows: PKCE S256 mandatory, single-use state tokens consumed on use,
  tokens stored server-side only, refresh rotation with reuse detection
  (30-day), public-client registration restricted to https/loopback/custom
  schemes.
- Every database table has row-level security; 97 tests prove outsiders see
  nothing, teammates see only team rows, and owners see their own.
- Sign-in codes: 6-digit, 1-hour expiry, single-use, delivered via
  authenticated SMTP; the local catch-all (Mailpit) is not reachable from the
  internet.

## Automated defenses now in place

| Control | Where |
|---|---|
| Branch protection (ruleset): no direct pushes/force-push/deletion on `main`, PR required, required checks | GitHub ruleset `main-branch-protection` |
| CodeQL SAST (security-extended) | `.github/workflows/codeql.yml` → Security tab |
| Trivy (CVE + secrets + misconfig, SARIF) | `.github/workflows/trivy.yml` |
| Gitleaks (independent secret scanner) | `.github/workflows/gitleaks.yml` |
| Repo-owned secret scanner (redacting, negative-tested) | `scripts/secret-scan.mjs` in the `ci` security job |
| Dependency audit gates (critical) | `ci` security job: `npm audit` ×3 surfaces + `deno audit` |
| Dependabot security updates + version updates (npm ×3, github-actions) | `.github/dependabot.yml` |
| SBOM (SPDX, app + desktop) | `.github/workflows/sbom.yml` |
| OpenSSF Scorecard | `.github/workflows/scorecard.yml` |
| DAST baseline (ZAP) weekly on the live origin | `.github/workflows/zap.yml` |
| RLS + authorization regression tests (97) | `supabase/tests/` |

## Open items with owners

1. Rotate the 19 exposed credential sets — **operator, P0**.
2. Execute one live consent round-trip per provider (Google ready now;
   register Slack/Procore consoles first) — **operator, P1**.
3. Physical-device matrix (incl. the onboarding walkthrough and screen readers)
   — **operator + hardware, P1**.
4. Enforce the CSP (move from report-only after reviewing collected reports)
   — **developer, P2**.
5. Webhook delivery retry queue — **developer, P2**.
6. Murmure AGPL boundary legal sign-off — **legal, P2**.
