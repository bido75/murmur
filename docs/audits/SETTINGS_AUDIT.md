# Settings audit (verification of the settings-page report)

Every section, with what is implemented vs unverified. Live-credential items are
BLOCKED per the audit rules.

| Section | UI | Backend | Verified working | Status |
|---|---|---|---|---|
| Recording notice | toggle | `user_settings.consent_reminder` | DB isolation test; record-time reminder wired | PASS |
| Field mode | toggle | `user_settings.field_mode` | override semantics fixed (no overwrite) | PASS (on-device check pending) |
| Default type | radios | `user_settings.default_template` | persisted cross-device; DB test | PASS |
| Save feedback | Saved/rollback | — | implemented; no automated UI test | PARTIAL |
| Calendar | connect cards | `calendar` function + connections | provider list verified; Google configured | PARTIAL (live OAuth pending) |
| Teams | create/join codes | `workspaces` + teams functions | DB tests (create/invite/roles/leave) | PASS |
| AI tools / MCP | api-access page | `mcp` + `oauth` functions, hashed tokens | config-derived endpoint verified; token flows unit-tested | PARTIAL (live untested) |
| Connections | integrations page | `connect` + `integrations` functions | Slack/GoogleDocs available verified; trackers token-verified | PARTIAL (live pending) |
| Highlight reels | reels pages | `share/index.ts` reels routes | routes exist; not live-tested | PARTIAL |
| Phone calls | phone page | `ringcentral` / `aircall` | RingCentral unconfigured; Aircall mismatch | BLOCKED |
| Devices | devices page | `ingest` DEVICE_SOURCES | pages exist; watch untested | PARTIAL |
| Automations | automations page | `automations` table + `after_ready` | DB tests (create/validate/private) | PASS |
| Alerts & digest | alerts page | `topic_alerts`, `weekly_digest`, `digest_time` | DB + unit tests | PASS |
| Webhooks & API | `/developers` | `webhooks` + `api` + HMAC delivery | CRUD/validation/signing/SSRF tested | PASS |
| Templates | templates page | `summary_templates` + library | logic tests | PASS |
| Privacy & data | privacy page | retention functions + deletion | DB tests (retention_due, deletion guard) | PASS |
| Uploads | pending count + Retry | `sync.ts` queue | live count verified | PASS |
| Account / sign out | email + sign out | Supabase auth | standard; sign-out excluded as destructive | NOT TESTED (by choice) |

## Re-test of the eleven original settings findings

See `FRONTEND_UX_AUDIT.md` table items 1–11: 3 fixed, 3 false positives (with
evidence), 4 verified already working, 1 partially open (dialog focus).