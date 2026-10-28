# 12 — Final release decision

Date: 2026-10-28
Decision: **CONDITIONAL** (unchanged in verdict, materially stronger in evidence)

## What this sprint changed

| Area | Before sprint | After sprint |
|---|---|---|
| Recording recovery (the audit's single FAIL) | 5 pure-function tests | **12 cross-process fault-injection tests over the real modules**; 2 real defects fixed (queue liveness gap, non-idempotent recovery) |
| Dependency security | not scanned | scanned on all 4 surfaces; 6 packages fixed; 3 risk-accepted with documented reachability; 1 high **mitigated at the application layer** (image-size guard for reachable user-photo path) |
| Secret scanning | manual greps | committed, redacting, negative-test-validated scanner in CI |
| CI workflow | 3 jobs, mutable tags, no scanning | 5 jobs, SHA-pinned actions, dep+secret scanning, DB-security job, build verification, artifacts |
| Migration safety | NOT VALID fix argued | **11-test rehearsal on legacy-shaped data** proving preservation, NOT VALID semantics, frozen-until-fixed updates, cleanup path, RLS, constraint validity |
| Long recordings | never measured | measured 15/30/60 min end-to-end; **2 production defects found and fixed** (unbounded notes prompt killing workers; stuck transient states with a new daily sweep) |
| Documentation HEAD references | stale | snapshot-role tables; dynamic HEAD verification; 87-vs-107 reconciled with disclosed audit bookkeeping inconsistencies |

Final test evidence (this folder's `test-results.json`): tsc 0, **192+32+92** tests,
deno 192, desktop tsc+92, e2e feature run, three long-recording runs, secret scan
clean, dependency gates green.

## Why still CONDITIONAL

The remaining gates are all operator/environment-owned, and none can be closed
by code:

1. **BL-2 (P0)** — push the branch + draft PR (authorization not yet given).
2. **BL-3 (P0)** — rotate the 15 credential sets exposed in chat (active
   compromised credentials are a hard release blocker).
3. **BL-4a/4b (P1)** — public HTTPS origin + provider-console registration +
   one live OAuth round-trip per provider (none executed; no mock claims).
4. **BL-13 (P1)** — physical-device matrix (mic lifecycle, real crash/restart,
   accessibility on-device).
5. **BL-15 (P1, new)** — record the GitHub Actions run URL + SHA after push.
6. **BL-10 residual** — client-side memory/battery on device; large-collection UI.
7. **BL-6 (P1, developer)** — webhook delivery retry queue (not in this sprint's scope).
8. **BL-8/9 (P2)** — telephony provider decision; tracker credential model.
9. **BL-LEGAL (P2)** — AGPL boundary sign-off.

Completion is not inflated: the verifiable-set PASS rate is 86.3% (69 of 80
verifiable enumerated rows; `11-REQUIREMENTS-RECONCILIATION.md`), and every
operator-owned item above remains explicitly open.
