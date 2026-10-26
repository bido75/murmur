# 13 — Full regression results

Executed after all remediation commits (HEAD `5d7ac7c` + docs).

## Commands and results

| Suite | Command | Result |
|---|---|---|
| App typecheck | `npx tsc --noEmit` | **clean** (exit 0) |
| App lint | `npx expo lint` | **clean** (exit 0) |
| App logic | `npm test` (test:logic) | **185 pass / 0 fail** |
| App units | `npm test` (test:app) | **20 pass / 0 fail** |
| Database security | `npm test` (test:db) | **77 pass / 0 fail** |
| Server typecheck | `deno check .` | **clean** (exit 0) |
| Server logic | `deno test --allow-all _shared/` | **185 pass / 0 fail** |
| Desktop typecheck | `desktop: npx tsc --noEmit` | **clean** (exit 0) |
| Desktop logic | `desktop: npm test` | **92 pass / 0 fail / 2 skipped** |

## Stability

The logic suite was run **three consecutive times** during this remediation with
identical results (185/185) — the intermittent OAuth DB-test timeout reported in
the earlier engineering docs did **not** reproduce in any run on this branch.

## Real end-to-end (executed earlier this engagement, unchanged since)

| Scenario | Result |
|---|---|
| sign-up → upload → Mistral transcribe → OpenRouter notes → `ready` | PASS (`scripts/test-local-pipeline.cjs`) |
| Deck / DOCX / ZIP downloads reachable (not `kong`) | PASS (`scripts/test-features.cjs`) |
| Translate to French / Swahili / Yoruba | PASS |
| Webhook SSRF constraint (private/metadata/kong blocked) | PASS (SQL + DB tests) |
| OAuth provider availability | PASS (`/calendar/providers` → google; `/connect/available` → slack, google_docs) |

## New tests added during remediation

| Test file | Tests | Guards against |
|---|---|---|
| `src/lib/recoveryPlan.test.ts` | 5 | recovery regression (unfinalized recording, lost parts) |
| `src/lib/settingsSave.test.ts` | 5 | settings rollback regression, failed-save leakage, field-mode override |

## Not executed (BLOCKED/NOT TESTED)

Live OAuth consent round-trips · physical-device runs · screen-reader runs ·
60-minute recording · performance at scale · production-data migration dry run.
See `09-MOBILE-DEVICE-TESTING.md` and `10-LONG-RECORDING-PERFORMANCE.md`.