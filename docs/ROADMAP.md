# Roadmap

Work top to bottom. Each item is one change; finish it, run the checks in `docs/agent/PROJECT_RULES.md`, then move on.
Tick the box when done.

## Milestone 0 — Get it running (mostly done by a person, not the agent)

- [ ] Create a Supabase project; `supabase init` (there's no `supabase/config.toml` yet), `supabase link`, `supabase db push`.
- [ ] Set secrets: `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `CRON_SECRET`.
- [ ] Deploy only the core functions first: `process-recording`, `ask`, `share`, `account`, `retention`, `live`, `export`.
- [ ] Magic-link email template shows `{{ .Token }}` (README step 3).
- [ ] `.env` from `.env.example`; run the web app (`npx expo start --web`) and record 30 seconds end to end.
- [ ] Dev build on a real phone (`npx eas-cli@latest build --profile development`); run the first 6 items of the README device checklist.
- [ ] Run the **Native builds** GitHub workflow once.

## Milestone 1 — Close the gaps users complain about (agent work)

These come from the competitor research: lost recordings, no way to check summaries against audio, ugly exports,
misheard words, and billing frustration.

1. [ ] **Real audio player on the recording screen.** Today a transcript line only seeks + plays (`src/app/recording/[id].tsx`).
   Add a sticky player bar: play/pause, scrubber with elapsed/total, skip back 15 s / forward 30 s, speed 0.75×–2×,
   current speaker. The transcript highlights and follows the line being played. Works across 5-minute parts
   (the code already maps ms → part with an offset). Accessible labels on every control.
2. [ ] **Timestamp chips on notes.** Every key point, decision and action item shows a small time chip that plays that moment
   (tasks already have `quote_ms`; add source times to key points/decisions in the summary prompt + `verify.ts`, with tests).
3. [ ] **Smaller loss window.** Phone parts are 5 min and web parts 2 min, so a crash can lose up to that much.
   Web: use `MediaRecorder.start(timeslice)` with ~5 s slices written to IndexedDB (`src/lib/webStore.ts`) and stitched per part.
   Phone: lower the part length (try 60 s) if processing cost allows, or document why not. Add tests for the stitching/ordering.
4. [ ] **Copy as rich text.** On web, write `text/html` + `text/plain` with `ClipboardItem` so headings and bullets survive pasting
   into Word, OneNote, Google Docs and Notion (`src/lib/dialog.ts`, `src/lib/export.ts`). On phones keep the share sheet,
   and offer the .docx export there.
5. [ ] **Silence / made-up text filter.** Especially for on-device Whisper (`whisper.rn`): drop segments in near-silent audio and
   collapse the same short phrase repeated 3+ times ("thank you thank you…"). Pure function in `_shared/`, with tests.
6. [ ] **Billing.** Free tier + one paid plan, monthly or yearly, no weekly plan. Apps sold inside the iOS/Android apps generally
   must use the stores' in-app purchase, so use RevenueCat for iOS/Android and Stripe for web, both writing one
   `entitlements` row per user via webhook (new migration + RLS + tests). Show a minutes meter on Home, warn at 80 %.
   At the limit, keep recording and saving audio; queue processing until upgrade or reset. Cancel from Settings in two taps.

## Milestone 2 — Harden before anyone pays

- [ ] Feature flags (one `features` config, server-checked) so untested integrations are hidden at launch. Ship with:
      recording, import, notes, tasks, search/ask, share links, export, teams, Claude/ChatGPT connector. Everything else off.
- [ ] Error reporting (e.g. Sentry for Expo) on app and functions; no transcript text in error logs.
- [ ] Load test: a 2-hour recording and 20 parallel uploads on the chosen Supabase plan.
- [ ] Replace the placeholder name everywhere (`APP_NAME` in `src/lib/config.ts`, `app.json`, desktop, extension, watch).
      Check the new name and domain for trademark conflicts first.
- [ ] Lawyer reviews the consent wording (`_shared/consent.ts`) and the privacy policy.

## Milestone 3 — Launch

- [ ] App Store / Play listings, privacy labels, account deletion (already built) verified by review.
- [ ] Web app on Vercel (`scripts/hosting-config.mjs`), `APP_URL` set.
- [ ] Turn on integrations one at a time, each after its README checklist item passes against a sandbox account.
