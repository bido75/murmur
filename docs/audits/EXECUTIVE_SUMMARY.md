# Executive summary

| | |
|---|---|
| Repository | https://github.com/bido75/murmur.git |
| Base branch | `main` @ `8d7ef81` (`8d7ef8138f5c5b8f6b9cb1764484ff70397adaf9`) |
| Enhancement branch | `feature/murmur-app-remediation` @ `c7cdc1d` (`c7cdc1d6014df28bc258505b84c3febd1fb5137b`) |
| Merge base | `8d7ef81` (= main HEAD, fast-forwardable) |
| Commits ahead | 37 |
| Files changed | 145 (61 modified, 84 added, 0 deleted, 0 renamed) |
| Insertions / deletions | +20,342 / −3,638 |
| Audit date | 2026-10-26 |
| Branch pushed? | **NO** — `git ls-remote origin` shows neither `feature/murmur-app-remediation` nor `feature/transcription-local` on the remote. `main` is the only pushed branch. |

## Requirements audited

Requirements were extracted from `writing-block (3).md` (the remediation prompt)
and counted individually. Desktop-only items were classified DEFERRED per the
prompt's own instruction.

| Outcome | Count | Notes |
|---|---|---|
| PASS | 61 | verified by test or real execution |
| PARTIAL | 14 | implemented, some aspect unverified or incomplete |
| FAIL | 1 | one reproducible defect |
| BLOCKED | 22 | needs provider console, credentials, or hardware |
| DEFERRED (desktop) | 9 | out of scope for this branch by instruction |
| **Total** | **107** | denominator disclosed |

Compliance: **57% PASS**, 13% PARTIAL, 1% FAIL, 21% BLOCKED, 8% deferred.
Of the *verifiable* set (PASS+PARTIAL+FAIL = 76): **80% PASS**.

## Tests executed (this audit, exact commands)

| Suite | Command | Result |
|---|---|---|
| App types | `npx tsc --noEmit` | clean (exit 0) |
| App lint | `npx expo lint` | clean (exit 0) |
| App logic | `npm test` (test:logic) | **185 pass / 0 fail** |
| App units | `npm test` (test:app) | **10 pass / 0 fail** |
| Database security | `npm test` (test:db) | **77 pass / 0 fail** |
| Server types | `deno check .` | clean (exit 0) |
| Server logic | `deno test --allow-all _shared/` | **185 pass / 0 fail** |
| Desktop types | `desktop: npx tsc --noEmit` | clean (exit 0) |
| Desktop logic | `desktop: npm test` | **92 pass / 0 fail / 2 skipped** |
| Git integrity | `git diff --check main..HEAD` | 4 trailing-whitespace lines in `scripts/test-transcription.mjs` |

## Security findings (confirmed)

| ID | Severity | Finding |
|---|---|---|
| SEC-1 | HIGH (fixed) | Webhook SSRF — private-IP/metadata destinations were fetchable. Closed in 3 layers (`ssrf.ts`, delivery-time DNS check, `webhook_url_public` constraint) with unit + DB tests. |
| SEC-2 | HIGH (fixed) | OAuth redirect / signed-download URLs used the Docker-internal `kong` host. Fixed with `publicApiBaseUrl()` + `clientUrl()`. |
| SEC-3 | CRITICAL (process, not code) | **All provider credentials used during this work were pasted into chat** — Google, Slack, Procore, HubSpot, and others. They must be rotated before production. No real secret is committed (verified: `git grep` finds only `sk-ant-...` doc placeholders; `.env*` gitignored). |
| SEC-4 | MEDIUM | Google OAuth live round-trip unverified: Google rejects the private-IP redirect (`device_id and device_name are required for private IP`). Needs a tunnel/domain + registered redirect URIs. |

## Release decision: **CONDITIONAL**

No confirmed critical vulnerability in code, no data-loss defect, and the core
recording → transcription → notes pipeline is verified end-to-end (a real WAV went
through sign-up → upload → Mistral transcription → OpenRouter notes → `ready`).
However: the branch is **not pushed**, the OAuth live round-trips are unverified, and
the exposed credentials are unrotated. Those three items are the gate to GO.

## The three questions

1. **Did we build everything requested?** No — 107 requirements: 61 PASS, 14 PARTIAL,
   1 FAIL, 22 BLOCKED, 9 deferred. The BLOCKED set is dominated by external
   console/credential work the code cannot do itself.
2. **Does it work correctly, reliably, securely?** The pipeline, settings persistence,
   accessibility semantics, SSRF hardening and provider fallback all have passing,
   meaningful tests. Unverified: live OAuth round-trips, physical-device
   accessibility, macOS/Linux, 60-minute recording.
3. **Is the branch safe to merge?** The diff is clean (no deleted features, no
   committed secrets, no broken migrations, additive-only schema), all suites pass,
   and no regression was found against `main`. Mergeable after the one FAIL below
   and the whitespace nit are addressed; **push it and open a PR first** — it has
   never left this machine.

## The one FAIL

REQ-1.3b — "Recall a failed upload / recover an interrupted recording" is
implemented (`recoverInterruptedRecording`) but has **no automated test** and was
not exercised end-to-end in this audit; recovery-after-crash on a real device
remains unproven. Everything else marked PARTIAL has a named, concrete gap in
`REQUIREMENTS_TRACEABILITY.md`.