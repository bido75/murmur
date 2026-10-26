# 02 — Remediation matrix

Maps every backlog item from `docs/audits/REMEDIATION_BACKLOG.md` to its
remediation. Statuses updated as work completes.

| Backlog | Requirement | Source location | Severity | Fix | Regression test | Status |
|---|---|---|---|---|---|---|
| 1 | REQ-1.3b | `src/lib/recorder.ts` (`recoverInterruptedRecording`) | HIGH | Extract the recovery decision into pure `recoveryPlan()`; recover via the tested plan | `src/lib/recoveryPlan.test.ts` (5 tests incl. unreadable-part and always-finalize) | **DONE** (`9540d62`) |
| 2 | — | repo | HIGH | Push both branches (BLOCKED: awaiting approval) | — | **BLOCKED (approval)** |
| 3 | REQ-9c | `supabase/functions/.env` | CRITICAL | Rotate Google/Slack/Procore/HubSpot/Deepgram/OpenRouter/Mistral/Anthropic (EXTERNAL: provider consoles) | — | **BLOCKED (operator)** |
| 4 | REQ-6.2a/6.3a | `calendar/connect/procore index.ts` | HIGH | Unified `publicApiBaseUrl()` for redirects; operator instructions written | endpoint tests (`/calendar/providers`, `/connect/available`) | **PARTIAL** (code done; live round-trip blocked) |
| 5 | REQ-3.4a | `src/app/(tabs)/settings.tsx` | MEDIUM | Extract tested save state machine (`settingsSave.ts` reducer) | `src/lib/settingsSave.test.ts` (5 tests incl. rollback and no-leak-after-fail) | **DONE** (`72093f9`) |
| 6 | REQ-5.1d | `supabase/functions/_shared/after_ready.ts` | LOW | Add `webhook_deliveries` table + scheduled retry with backoff | delivery-log tests | NOT STARTED |
| 7 | REQ-4.4b | `src/app/(tabs)/search.tsx` | LOW | Filter chips (date/project/type) feeding the RPC | search tests | NOT STARTED |
| 8 | REQ-7.4a | `supabase/functions/ringcentral` / `aircall` | MEDIUM | Provider decision: RingCentral creds or Aircall-native import | — | **BLOCKED (decision)** |
| 9 | REQ-6.3c | `supabase/functions/_shared/trackers.ts` | MEDIUM | Decide token-paste vs OAuth-client registry | — | **BLOCKED (decision)** |
| 10 | REQ-11a | recordings/search | LOW | Seeded performance benchmark | measured numbers | NOT STARTED |
| 11 | REQ-10 | `scripts/test-transcription.mjs` | LOW | Trim trailing whitespace | `git diff --check` | NOT STARTED |
| 12 | — | 60 files | LOW | Commit or discard the quote normalization | clean `git status` | NOT STARTED |
| 13 | Phase 11 | physical devices | MEDIUM | On-device matrix (EXTERNAL: hardware) | device run log | **BLOCKED (hardware)** |
| 14 | Phase 11 | `desktop/src/**` | MEDIUM | macOS/Linux runs (EXTERNAL: hardware) | run log | **BLOCKED (hardware)** |

## PARTIAL/FAIL requirement mapping (from requirements-matrix.csv)

| Requirement | Was | Now | Evidence |
|---|---|---|---|
| REQ-1.3b (FAIL) | FAIL | **PASS** | 5 recovery-plan tests; behavior unchanged, decision now proven |
| REQ-3.4a (PARTIAL) | PARTIAL | **PASS** | 5 settings-save reducer tests; rollback + no-leak proven |
| REQ-1.2c (background recording) | PARTIAL | PARTIAL | BLOCKED: needs dev build, not Expo Go |
| REQ-2.1a (dialog focus) | PARTIAL | PARTIAL | needs real keyboard/screen-reader run |
| REQ-4.4b (search filters) | PARTIAL | PARTIAL | backlog 7 |
| REQ-5.1d (webhook retry) | PARTIAL | PARTIAL | backlog 6 |
| REQ-5.2b/5.5 (MCP live, reels live) | PARTIAL | PARTIAL | live round-trips blocked on provider config |
| REQ-6.2a/6.3a/6.3b (OAuth live) | PARTIAL | PARTIAL | code done; operator console work remains |
| REQ-7.3a/7.4a (devices/telephony) | PARTIAL/BLOCKED | unchanged | external |