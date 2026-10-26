# 08 — Feature completion

Status of every PARTIAL/FAIL requirement after this remediation, plus what is
verified PASS. PASS items are not repeated here — see
`docs/audits/requirements-matrix.csv`.

## Fixed to PASS

| Requirement | Fix | Test |
|---|---|---|
| REQ-1.3b interrupted-recording recovery | pure `recoveryPlan()` decision, applied by `recoverInterruptedRecording` | 5 tests: readable part, local part, unreadable part skipped-but-finalized, no session, finalize-always |
| REQ-3.4a settings save feedback | tested reducer (`settingsSave`) drives the Settings screen: optimistic → commit/rollback | 5 tests: optimistic, commit, rollback, no-leak-after-fail, field-mode override |
| Field-mode semantics | `effectiveDefaultTemplate` (tested) | part of settingsSave tests |

## PARTIAL (implemented; specific missing aspect named)

| Requirement | Implemented | Missing | Plan |
|---|---|---|---|
| REQ-1.2c background recording | code + audio mode set | Expo Go cannot background-record | dev build test (BLOCKED: hardware) |
| REQ-2.1a dialog focus/Escape | shared dialog surface | real keyboard/screen-reader run | device matrix (BLOCKED: hardware) |
| REQ-4.4b search filters | full search + Ask | filter chips (date/project/type) | backlog 7 |
| REQ-5.1d webhook retry | signing + last-status | retry queue with backoff | backlog 6 |
| REQ-5.2b MCP token UX | hashed tokens, one-time reveal, revoke | live round-trip | needs deployed origin |
| REQ-5.5 highlight reels | pages + reel routes | live clip flow untested | needs deployed origin |
| REQ-6.2a Google Calendar OAuth | full connect/callback/refresh/disconnect + creds | live consent round-trip | operator console work (06-OAUTH doc) |
| REQ-6.3a Slack/Google Docs OAuth | full connect/callback + creds | live consent round-trip | same |
| REQ-6.3b Procore OAuth | full connect/callback/refresh + sandbox creds | live round-trip | same |

## BLOCKED (external)

Microsoft/OneNote/Salesforce OAuth (no creds) · RingCentral/Aircall/Twilio
telephony (provider mismatch) · watch pairing (hardware) · physical-device
accessibility · performance at scale (needs seeded data).

## Verified PASS (spot list)

Full pipeline with real audio · engine fallback · settings persistence +
isolation · webhook SSRF hardening · signed download URLs · translation incl.
African languages · exports/decks · search + Ask with citations · teams/roles ·
retention/deletion guards · speech-model attribution.