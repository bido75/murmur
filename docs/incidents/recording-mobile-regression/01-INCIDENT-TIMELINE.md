# P0 incident: web recording regression + Expo Go inaccessibility

Opened: 2026-10-30 · Status: **Web recording — ROOT CAUSE FIXED AND DEPLOYED (pending user device retest); Expo Go — diagnosed, moved to development-build path; APK — staged on EAS auth**

## Timeline (all times UTC where known)

| When | Event |
|---|---|
| 2026-10-28/29 | Cloudflare Tunnel `notes.giscop.com` configured; web recording verified working through it (release-verification sprint) |
| 2026-10-29 | Security hardening (`2065aac`): response headers added to `serve-web-dist.cjs`, including `Permissions-Policy: camera=(), microphone=(), …` — a scanner-recommended deny-all that was wrong for a recording app |
| 2026-10-29/30 | Desktop V2 phases 0–7, installer pipeline, EAS staging |
| 2026-10-30 | Operator reports: (A) hosted web recording fails — "The browser is not allowed to use the microphone" (Android); (B) Expo Go cannot open the project |
| 2026-10-30 | Root cause A found and fixed live: `microphone=(self)`; verified through the tunnel |

## Findings in one line each

- **A (web recording)**: the browser-visible `Permissions-Policy: microphone=()` header blocked `getUserMedia` before prompting → `NotAllowedError`. Introduced by the hardening pass; not by recording code. Fixed live; 4-test regression guard added.
- **B (Expo Go)**: project is Expo SDK 58 / RN 0.88. Expo Go only runs the SDK version it was built for; without the matching Expo Go the project cannot open. The supported path — per Expo and per the operator's own prompt — is a development build (EAS). Staged; blocked only on the operator's Expo account login.

## Verification you can do right now

1. Open `https://notes.giscop.com` in Android Chrome → recording should prompt and work (force-close Chrome first if the page was open).
2. The response header check: `curl -I https://notes.giscop.com | findstr permissions` → `camera=(), microphone=(self), …`

## Addendum — 2026-10-30 later (export/share link failure)

- The operator confirmed **web recording works on the phone** (Failure A closed on real hardware).
- New finding: exported/shared notes produced links at \http://10.0.0.180:54325\ — a port **nothing listens on** (it was a stale value in \supabase/functions/.env: EXTERNAL_SUPABASE_URL\). Every signed URL from share/export/make-deck was rewritten there by \clientUrl()\.
- Port map clarified for the operator: 54321 kong/API · 54322 postgres · 54323 studio · 54324 Inbucket (the local email-capture UI) · **54325 nothing**.
- Two fixes: (1) \EXTERNAL_SUPABASE_URL=https://notes.giscop.com\ deployed to the Edge Runtime (verified in container env); (2) \ewriteHost\ port-leak bug fixed (kong:8000 leaked onto portless https origins) + regression test. Deno suite 193/0; functions healthy local + tunnel (bot/available 200 both).
- Rollback: restore the old .env value and restart functions (restores the dead links).
