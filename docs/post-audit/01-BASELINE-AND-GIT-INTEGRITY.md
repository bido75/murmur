# 01 — Baseline and git integrity

Verified 2026-10-26, before any remediation change.

| Item | Value |
|---|---|
| Branch | `feature/murmur-app-remediation` |
| Audit commit | `c2bf90f` — exists; **is HEAD at reconciliation time** (the audit commit was the tip) |
| Reported implementation HEAD | `c7cdc1d` — exists; is the **parent** of the audit commit (audit docs were committed on top of the implementation) |
| Base | `main` @ `8d7ef8138f5c5b8f6b9cb1764484ff70397adaf9` |
| Merge base | `8d7ef81` (= main HEAD) |
| `merge-base --is-ancestor c2bf90f HEAD` | exit 0 — yes |
| Pushed? | **No** — `git ls-remote --heads origin` shows neither feature branch |
| Remote | `https://github.com/bido75/murmur.git` |

Commands run: `git status --short`, `git branch -avv`, `git remote -v`,
`git log --oneline --decorate --graph --all -50`, `git merge-base main
feature/murmur-app-remediation`, `git merge-base --is-ancestor c2bf90f HEAD`,
`git diff --check main...HEAD`, `git diff --stat main...HEAD`.

## Working tree at reconciliation

60 uncommitted modified files. Verified by diff-inspection: they are the
**pre-existing repo-wide quote-style normalization** (single→double quotes) that
predates the audit commit — no functional changes, no new behavior, no secrets.
They are left uncommitted (not discarded) per the prompt, and are not part of the
remediation commits.

## Post-audit changes

Five commits were made after reconciliation, so HEAD is ahead of the audit
commit. Current HEAD at reconciliation update: `8ac5ab6`.

| Commit | Contents |
|---|---|
| `9540d62` | Recording-recovery plan extraction + 5 regression tests + CI workflow (Stage B/C) |
| `72093f9` | Settings save/rollback reducer + 5 regression tests (Stage D) |
| `5d7ac7c` | Post-audit deliverables: baseline reconciliation, remediation matrix, recovery/OAuth/credential/CI validation docs |
| `aad9a61` | Post-audit docs: settings-save/recovery validation, migration NOT-VALID fix, operator checklists |
| `8ac5ab6` | Final release readiness: CONDITIONAL, gates documented |

A documentation-corrections commit (`c4b26e3e7b149621b5abe6047318796e9e42e812`)
— deliverable numbering 04, remediation CSV, JSON validity, HEAD references —
is applied on top of `8ac5ab6`.

## Commit roles

| SHA | Role |
|---|---|
| `8ac5ab6` | Application implementation snapshot (last application-code commit; all functional suites were run against this state) |
| `c4b26e3` | Documentation-only corrections (no application code) |
| current HEAD | Verify dynamically (`git rev-parse HEAD`) — do not hardcode a moving HEAD in prose |

## Conclusion

The audit commit, the reported implementation HEAD and the base are all verified
consistent: the audit ran against the exact implementation it reported on, and
nothing was modified between the audit and reconciliation. The remediation
commits are cleanly separated on top.