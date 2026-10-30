# 12 — Final release decision

Date: 2026-10-29 (refresh; original sprint 2026-10-28)
Decision: **CONDITIONAL** (unchanged in verdict, materially stronger in evidence)

## What changed since the original sprint report

The infrastructure work that this refresh adds is mostly **operational
unblocking**, verified with live evidence:

- **The app is publicly reachable at `https://notes.giscop.com`** — web app and
  API on one origin via a cloudflared tunnel with path-based routing; the web
  bundle is built for the public origin (no localhost anywhere).
- **Sign-in codes are delivered by real SMTP** (giscop.com mailbox) and the
  whole sign-in flow was exercised through the public domain: OTP requested →
  delivered → verified → session obtained.
- **OAuth connect works up to the provider round-trip**: the real
  `UNAUTHORIZED_NO_AUTH_HEADER` root cause (edge-runtime JWT gate on provider
  callbacks) is fixed with per-function `verify_jwt = false`; a full callback
  was replayed over the domain (state consumed single-use, 302 back to the
  app). Google's console URIs are registered by the operator.
- **The Claude/ChatGPT MCP connector handshake is verified end-to-end** over
  the domain: 401 hint → both discovery documents → dynamic client
  registration minted a client for Claude's callback URL (the "Couldn't
  register with Murmur's sign-in service" failure is fixed).
- **A full onboarding system shipped** (7-stop welcome tour, self-ticking
  getting-started checklist, one-time tips, private analytics) with its own
  migration, RLS tests and logic tests.
- **CI caught two real regressions** after the sprint (portability of the
  secret scan; a lockfile desync from `expo install --fix`) and the final run
  is green: https://github.com/bido75/murmur/actions/runs/40829899080.

## Why still CONDITIONAL

The remaining gates are all operator-owned, and none can be closed by code:

1. **BL-3 (P0)** — rotate the 19 credential sets exposed in chat (active
   compromised credentials are a hard release blocker).
2. **BL-4b (P1)** — one live consent click-through per provider. Google is now
   executable by the operator (console registered, callbacks live); Slack and
   Procore need their console registration first. No round-trip has been
   performed — nothing is claimed.
3. **BL-13 (P1)** — physical-device matrix (mic lifecycle, real crash/restart
   on hardware, accessibility on-device).
4. **BL-6 (P1, developer)** — webhook delivery retry queue (not in scope).
5. **BL-8/9 (P2)** — telephony provider decision; tracker credential model.
6. **BL-LEGAL (P2)** — AGPL boundary sign-off.

Completion is not inflated: the verifiable-set PASS rate is 86.3% (69 of 80
verifiable enumerated rows; `11-REQUIREMENTS-RECONCILIATION.md`), and every
operator-owned item above remains explicitly open. The onboarding system is
**new scope beyond the original 107 requirements** (shipped, tested, RLSed)
and does not change any previously reported status.

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

Final test evidence (this folder's `test-results.json`, refreshed 2026-10-29):
tsc 0, **192+43+97** tests, deno 192, desktop tsc+92, e2e feature run, three
long-recording runs, secret scan clean, dependency gates green, GitHub CI green
on the latest SHA.
