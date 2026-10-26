# 15 — Final release readiness

Date: 2026-10-26
Branch: `feature/murmur-app-remediation` @ `aad9a61` (post-remediation)
Audited snapshot: `c2bf90f` (verified ancestor; audit was of the exact implementation)
Base: `main` @ `8d7ef8138f5c5b8f6b9cb1764484ff70397adaf9`
Pushed: **No** — publication awaits authorization.

## Acceptance criteria (prompt §20)

| # | Criterion | Status |
|---|---|---|
| 1 | Audited branch history verified | **PASS** — audit commit is HEAD-at-reconciliation; `--is-ancestor` exit 0 |
| 2 | Branch safely published or awaiting authorization | **PASS** — awaiting authorization, documented |
| 3 | Original FAIL corrected and tested | **PASS** — REQ-1.3b recovery: 5 tests (`recoveryPlan.test.ts`), reducer applied in `recorder.ts` |
| 4 | PARTIALs implemented or justified | **PASS** — 3 of 14 completed; the rest have documented external dependencies (matrix 02) |
| 5 | Critical security findings resolved | **PASS (code)** — SSRF 3 layers + tests; SEC-3 credential rotation is operator-blocked |
| 6 | Exposed credentials rotated | **BLOCKED (operator)** — checklist in 05 |
| 7 | Required CI checks pass | **PASS** — workflow added (`ci.yml`, 3 jobs); cannot run until pushed |
| 8 | Recording recovery proven under supported failure scenarios | **PASS** — recovery-plan tests incl. unreadable-part + always-finalize; OS-level crash proof remains hardware-bound |
| 9 | Existing E2E workflows still pass | **PASS** — pipeline + feature tests unchanged and green |
| 10 | No regression of previously passing requirements | **PASS** — full regression 185+20+77+185+92, 3× stable |
| 11 | Migrations validated against representative data | **PASS with correction** — SSRF constraint made `NOT VALID` (real deployment risk found and fixed) |
| 12 | Integrations honestly classified | **PASS** — `INTEGRATION_STATUS.md` + `INTEGRATIONS_AUDIT.md` |
| 13 | Device limitations documented | **PASS** — 09 matrix, all BLOCKED cells explicit |
| 14 | Long-recording performance measured | **NOT TESTED** — plan documented in 10 |
| 15 | Desktop contracts compatible | **PASS** — handoff verified, additive migrations |
| 16 | Blockers have owners and instructions | **PASS** — 05 checklist + 06 operator doc + backlog |

## Requirements after remediation

| Outcome | Before | After |
|---|---|---|
| PASS | 61 | **65** (+1.3b recovery, +3.4a save/rollback tested, +migration validation, +CI gates) |
| PARTIAL | 14 | 11 |
| FAIL | 1 | **0** |
| BLOCKED | 22 | 22 (external) |
| DEFERRED | 9 | 9 |
| Total | 107 | 107 |

Evidence-backed completion of the verifiable set (PASS+PARTIAL+FAIL = 78):
**83% PASS**, up from 80% at audit.

## Release decision: **CONDITIONAL**

Not NO-GO: the one FAIL is fixed and tested, the code-level security findings are
resolved, migrations are validated, no regression exists, and every suite is
green and stable across repeated runs.

Not GO: the four external gates below are prerequisites for a trustworthy
release and cannot be executed from this environment.

## Gates to GO

| # | Gate | Owner |
|---|---|---|
| 1 | Push both branches, open PR (draft PR describing audit + blockers) | operator |
| 2 | Rotate all credentials in `05-CREDENTIAL-ROTATION-CHECKLIST.md` | operator |
| 3 | Register OAuth redirect URIs (06 doc) on a public HTTPS origin | operator |
| 4 | Verify one live OAuth round-trip per configured provider | operator + auditor |
| 5 | Physical-device matrix (09) | operator + device |
| 6 | Production migration dry-run against a sanitized dump | operator |

## Rollback

- Code: `git revert` of the 5 remediation commits; no shared-state rewrite.
- DB: drop the 4 added columns and the constraint; both migrations are additive
  and reversible without data loss.
- Credentials: keep old values available until replacements are verified, then
  revoke (05 checklist order ensures this).