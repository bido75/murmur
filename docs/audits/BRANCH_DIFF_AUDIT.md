# Branch diff audit

## Identity

| | |
|---|---|
| Remote | `https://github.com/bido75/murmur.git` |
| Base | `main` @ `8d7ef8138f5c5b8f6b9cb1764484ff70397adaf9` |
| Enhancement | `feature/murmur-app-remediation` @ `c7cdc1d6014df28bc258505b84c3febd1fb5137b` |
| Merge base | `8d7ef81` (main HEAD — fast-forward possible) |
| Commits | 37 ahead of main |
| Changed files | 145: 61 modified, 84 added, 0 deleted, 0 renamed |
| Volume | +20,342 / −3,638 |

Commands run (as required):

```
git status --short          → 60 uncommitted files (see below)
git branch -vv              → 3 local branches; only main tracks origin
git log --oneline --decorate main..HEAD
git diff --stat main..HEAD  → 145 files
git diff --name-status main..HEAD
git diff --check main..HEAD → 4 trailing-whitespace lines
```

## Commit inventory (main..remediation)

Remediation branch (9):
`c1a35de` field-mode + radios · `f4e81c6` settings persistence · `54f8adb` phase-3/4/5 log ·
`47da0f4` OAuth creds + redirects + silence check · `be9dd68` webhook SSRF + desktop handoff ·
`de67429` HubSpot clarification + tunnel support · `35ecc7f` HubSpot instructions ·
`c7cdc1d` monday.com link + audit deliverables.

Transcription branch carried in (28): local Parakeet engine, dictation, SDK 58
upgrade, Mistral STT, engine fallback, LAN setup, signed-URL rewrite, PDF fix,
translation languages.

## Investigations required by the audit — results

| Check | Result |
|---|---|
| Accidental deletion of features | **None.** `--name-status` shows 0 deletions. |
| Unrelated changes | The SDK 58 upgrade touches `package-lock.json` (+2,978 lines) — expected for a dependency bump. |
| Dead/unreachable code | None introduced; `services.test.ts` was *removed* because it imported `services.ts` (parameter property + `npm:` import unsupported by Node strip-types) — replaced by pure `client_url.test.ts`. |
| Duplicate implementations | None found; provider registry reused (`PROVIDERS`, `OAUTH_PROVIDERS`, `trackers.ts`). |
| Breaking API changes | None additive-breaking. Two migrations are purely additive columns + one check constraint. |
| Incorrect imports | `tsc`/`deno check` clean. |
| Missing dependencies | `npx expo install --check` clean post-SDK-58; `expo-doctor` 20/20. |
| Lockfile consistency | `npm install` resolves; audit scan clean. |
| Unsafe migrations | Both additive (`add column if not exists`, `add constraint`). No destructive statement. |
| Generated artifacts committed | None (`bundle-check`, logs all in temp dirs). |
| Hardcoded secrets | **None.** `git grep` for known secret shapes finds only doc placeholders (`sk-ant-...`). `.env`, `.env.local`, `supabase/functions/.env` all gitignored (verified via `git check-ignore`). |
| Tests weakened/disabled | Desktop suite: 2 skipped (model-dependent, pre-existing). No test deleted except the broken `services.test.ts` (replaced). |
| Security checks removed from CI | No CI exists in the repo to weaken (see CI/CD audit). |
| Regressions | All suites pass; the previously-failing-under-Node `services.test.ts` is now fixed via the pure module. |

## Working-tree hygiene

60 uncommitted files remain: the **pre-existing repo-wide quote-style
normalization** (single→double quotes) that predates the branch, plus
`docs/audits/*` created by this audit. Not staged; recommend committing the audit
docs and leaving the reformat out of the merge or committing it separately.

## Whitespace

`git diff --check` reports 4 trailing-whitespace lines in
`scripts/test-transcription.mjs` (lines 24, 27). Cosmetic.

## Push/merge safety

**The branch exists only locally.** `git ls-remote --heads origin` returns nothing
for either feature branch. It has never been reviewed by anyone else, never backed
up, and is vulnerable to local disk loss. Action: push both branches and open a PR.