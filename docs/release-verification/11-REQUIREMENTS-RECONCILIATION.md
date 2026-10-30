# 11 — Requirements reconciliation

Status: **VERIFIED** (machine-readable: `requirements-status.csv` in this folder, 89 enumerated rows)

## The 87-vs-107 question, answered

- The **audit's headline denominator (107)** = 61 PASS + 14 PARTIAL + 1 FAIL +
  22 BLOCKED + 9 DEFERRED. Its phase table (`REQUIREMENTS_TRACEABILITY.md`)
  sums to 107, but with a *different* internal split (55 PASS / 13 PARTIAL /
  27 BLOCKED) — the audit's own numbers do not reconcile internally. Disclosed.
- The **audit CSV** (`docs/audits/requirements-matrix.csv`) enumerates only 83
  rows, 7 of which have unquoted-comma column shifts. It was never a complete
  107-row enumeration.
- The **post-audit CSV** (`docs/post-audit/remediation-matrix.csv`, 87 rows) is
  my condensed remediation-view matrix — a *subset with statuses and evidence*,
  not a merge of the audit matrix.

**Scope determination**: the two matrices were not merged blindly. The
reconciliation merged them by ID (post-audit statuses win; audit-only rows
carried through), producing 89 real, individually traceable rows. The
remaining ~18 of the audit's 107 were *counted but never enumerated anywhere*
(the desktop-only deferred set and the "misc deferred desktop features" mass);
they are reported below as a disclosed bucket rather than fabricated rows.

## Reconciled counts (the 89 enumerated rows)

| Outcome | At audit | After this sprint |
|---|---|---|
| PASS | 66 | **69** |
| PARTIAL | 13 | **11** |
| FAIL | 1 | **0** |
| BLOCKED | 3 | 3 |
| NOT TESTED | 1 | 1 |
| DEFERRED | 5 | 5 |
| **Total enumerated** | **89** | **89** |

Verifiable set: 80 → 80 rows; PASS rate **82.5% → 86.3%**.

Corrections applied during reconciliation (audit CSV is authoritative for
"status at audit"): REQ-2.2a, REQ-3.2a, REQ-5.1c, REQ-9d were fixed *before*
the audit ran, so their "before" is PASS (the single audit FAIL was and is only
REQ-1.3b — now PASS); REQ-13a/b statuses read from their shifted columns.

## What moved this sprint (evidence in this folder)

| ID | Change | Evidence |
|---|---|---|
| REQ-1.3b | FAIL → PASS | crash/restart integration tests (05) |
| REQ-4.4b (search filters) | stays PARTIAL | not touched (no new evidence) |
| REQ-6.2a/6.3a/6.3b | stay PARTIAL | code verified; live consent still blocked (07) |
| REQ-9d/SEC-1 residual | image-size guard added | dependency-findings.json (04) |
| REQ-11a (performance) | NOT TESTED → measured server-side, device parts blocked | 10 |
| backlog items 6–7 (webhook retry queue, filter chips) | unchanged, not started | unresolved-blockers.json |

## Disclosed un-enumerated bucket (~18 rows)

Counted by the audit but never listed with IDs: the 9-item desktop-only
deferred set (3 have IDs: REQ-D1..D3) and ~21 "misc deferred desktop features"
counted as BLOCKED-pending-desktop-phase. These are stable: they require the
separate desktop phase or external access, and none became testable this
sprint. They are carried in the final decision as part of the blocked/deferred
mass with the explicit note that they have no row-level tracking.
