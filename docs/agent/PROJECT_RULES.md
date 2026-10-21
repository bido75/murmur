# Project rules for coding agents (opencode, Claude Code, Cursor)

Read this together with `AGENTS.md` (Expo rules) and `docs/ROADMAP.md` (what to work on next).

## What this is

Murmur is an AI note taker (Wave / Otter / Granola category). One codebase:

- `src/` — Expo Router app for iOS, Android **and web** (`npx expo export --platform web`).
- `supabase/migrations/` — Postgres schema + row-level security (RLS). 44 tables, all with RLS.
- `supabase/functions/` — Deno Edge Functions. Pure logic lives in `_shared/*.ts` so it can be unit-tested.
- `desktop/` (Electron), `extension/` (Chrome), `watch/` (watchOS), `wear/` (Wear OS), `zapier/`, `modules/` (Android foreground service).

Product promise: **never lose a recording, and every note/task can be checked against what was actually said.**
Action items and site-log entries carry the transcript quote they came from (`_shared/verify.ts`). Keep it that way:
never let the AI create a task, decision or "done" status without a quote that `verify.ts` finds in the transcript.

## Before you say a task is done

Run all of these and fix what fails:

```bash
npx tsc --noEmit
npx expo lint
npm test                                   # logic tests + database security tests (PGlite)
cd supabase/functions && deno check */index.ts && deno test --allow-all _shared/
```

If you touched `desktop/`: `cd desktop && npx tsc --noEmit -p . && npm test`.

## Rules

1. **Small steps.** One roadmap item per change. Don't refactor unrelated code. Don't rename the app or move folders.
2. **Database changes = a new migration file**, named `supabase/migrations/YYYYMMDDHHMMSS_<what>.sql` with a timestamp later
   than the newest one. Never edit an existing migration.
3. **Every new table**: `enable row level security`, explicit policies, and a test in `supabase/tests/*.test.mjs`
   (see `harness.mjs`) proving an outsider can't read or write it and a teammate only sees team rows.
4. **Logic goes in `_shared/*.ts` as pure functions** with a `*.test.ts` next to it. `index.ts` files only do I/O.
5. **Secrets never reach the app.** Only `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_APP_URL`
   may be in `.env`. Anthropic, Deepgram, Stripe/RevenueCat secret keys, provider client secrets: Supabase secrets only.
6. **Never delete or overwrite user audio** because of an error, a quota, or a failed upload. Local audio is removed only after
   a confirmed upload (`src/lib/sync.ts`).
7. **No new meeting-bot or auto-join behaviour.** The Recall.ai notetaker stays opt-in per meeting.
8. **Don't add npm packages to the app with `npm install`** — use `npx expo install <pkg>`. Prefer Expo modules.
9. **Don't create or edit `ios/` or `android/`** — use `app.json` and config plugins.
10. **Third-party integrations** (Procore, Twilio, Aircall, RingCentral, HubSpot, Salesforce, etc.) are built but untested against
    live accounts. Don't add more until the roadmap says so.
11. After a feature lands, add a row to the matching table in `README.md` and a line to its device checklist.
12. Plain-language UI copy: short sentences, no jargon, say what happened and what to do next.
