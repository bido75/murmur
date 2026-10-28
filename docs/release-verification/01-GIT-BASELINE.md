# 01 — Git baseline

Status: **VERIFIED** (2026-10-28)

| Check | Command | Result |
|---|---|---|
| Branch | `git branch --show-current` | `feature/murmur-app-remediation` |
| HEAD | `git rev-parse HEAD` | `052c730` (moves with this sprint; see commit list below) |
| Audit commit exists | `git cat-file -t c2bf90f` | commit |
| Implementation snapshot exists | `git cat-file -t 8ac5ab6` | commit |
| Documentation commit exists | `git cat-file -t c4b26e3` | commit |
| Ancestry | `git merge-base --is-ancestor c2bf90f HEAD` | exit 0 |
| Ancestry | `git merge-base --is-ancestor 8ac5ab6 HEAD` | exit 0 |
| Merge base with main | `git merge-base main HEAD` | `8d7ef81` = main HEAD (fast-forwardable) |
| Remote | `git remote -v` | `https://github.com/bido75/murmur.git` |
| Pushed? | `git ls-remote --heads origin` | only `main` + dependabot branches; **neither feature branch exists on origin** |
| Uncommitted work | `git status --short` | 60 modified files — the pre-existing repo-wide quote-style normalization, preserved untouched (0 untracked, 0 staged) |
| Merge conflicts | `git diff --check main...HEAD` | clean (the two trailing-whitespace lines found at sprint start were fixed in Stage 1) |

## Commit roles (fixed, not moving)

| SHA | Role |
|---|---|
| `8d7ef81` | `main` base |
| `c7cdc1d` | implementation HEAD at audit time |
| `c2bf90f` | independent audit commit (ancestor of HEAD, verified) |
| `8ac5ab6` | **application implementation snapshot** (state all functional suites run against) |
| `c4b26e3` | documentation-only corrections |

## This sprint's commits

| Commit | Stage |
|---|---|
| `8e88e07` | Stage 1: baseline verified; document commit roles; whitespace hygiene |
| `7ac7718` | Stage 2: CI hardening + dependency security |
| `fc6e7a8` | Stage 3: prove interrupted-recording recovery end to end |
| `052c730` | Stage 5: migration rehearsal, stuck-recording sweep, transcript cap, long-recording measurements |
| (final commit) | Stage 6: release-verification deliverables (this folder) |

## Secrets in history

`scripts/secret-scan.mjs` (repo-owned scanner, negative-test-validated) over the full tracked tree and the merge-base→HEAD diff: **clean**. `git ls-files` shows only `.env.example` (placeholders). No destructive commands were used anywhere; the 60 pre-existing uncommitted files were preserved.
