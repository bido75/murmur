# Supabase backend verification

Backend behavior was verified independently of the microphone so browser-permission
failures can't be confused with backend failures.

| Area | Result | Evidence |
|---|---|---|
| Auth (OTP) | PASS (2026-10-29 live e2e: code delivery via SMTP + session) | release-verification; unchanged since |
| Database/RLS | PASS | 40+ DB tests incl. RLS suites green in CI; untouched by desktop commits |
| Storage upload path | PASS (API/storage 200s through the tunnel; upload flow exercised in release verification) | — |
| Edge Functions | PASS | `deno test --allow-all _shared/` → **192 passed / 0 failed** (2026-10-30, re-run during this incident) |
| Processing pipeline | unchanged | `process-recording` contract stable; engine fallback server-side only |
| CORS | N/A for native/web-app fetches to same origin + Supabase direct (no browser-CORS dependency for the APK) | — |

A new controlled fixture upload was not re-run today; the standing evidence is the
2026-10-29 live verification plus today's green Deno/backend tests. Operator can
re-run the click-through end-to-end once recording is confirmed on device.
