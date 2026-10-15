# Murmur

An AI note taker in the same category as Wave: record meetings, calls, lectures and site walks on your phone, get a transcript, notes and **action items you can trust**. "Murmur" is a placeholder name; change `APP_NAME` in `src/lib/config.ts` and `name` in `app.json`.

## What's in this build

| Feature | Where |
| --- | --- |
| One-tap recording that keeps going with the screen locked | `src/app/record.tsx`, `src/lib/recorder.ts` |
| **Never-lose-a-recording**: audio is cut into 5-minute parts; each finished part is moved to permanent storage and queued for upload while you keep recording | `src/lib/recorder.ts` |
| Crash recovery: if the app dies mid-recording, the saved parts (and the current one, if readable) are processed on next launch | `recoverInterruptedRecording()` |
| Mic health: warns on 45 s of silence or if the system takes the mic; one-tap "Restart mic" | `src/lib/recorder.ts` |
| Works offline: recordings queue locally and upload automatically with retries; local audio is deleted only after a confirmed upload | `src/lib/sync.ts` |
| Import audio/video files | `importAudio()` in `src/lib/api.ts` |
| Transcript with speaker labels, tap any line to play from there | `src/app/recording/[id].tsx` |
| Notes: overview, key points, decisions, open questions, per type (meeting, lecture, phone call, **site walk**, sales call, interview) | `supabase/functions/_shared/prompts.ts` |
| **Verified action items**: each task carries the exact quote it came from; quotes not found in the transcript, owners never named, and "we could…" suggestions are flagged for review instead of silently becoming tasks | `supabase/functions/_shared/verify.ts` (+ tests) |
| Tasks tab across all recordings: Open / To review / Done | `src/app/(tabs)/tasks.tsx` |
| Ask questions about a recording | `supabase/functions/ask` |
| Share notes as text or PDF | `src/lib/export.ts` |
| Recording notice: reminds you to tell people and logs that you did | `record.tsx`, `recordings.consent_confirmed_at` |
| Email + 6-digit code sign-in (no passwords, no passkeys) | `src/app/sign-in.tsx` |
| Private by default: row-level security on every table, private audio bucket | `supabase/migrations/` |

### Phase 2, batch 1

| Feature | Where |
| --- | --- |
| **Web app** from the same code: sign in, record in the browser, review notes and tasks, import files, export | `npx expo export --platform web` |
| **Projects** group recordings by client, job site or team | `src/app/(tabs)/projects.tsx`, `src/app/project/[id].tsx` |
| **Carry-over brief**: before recording in a project you see what's still open; after, the notes mark earlier tasks done or blocked, but only when the transcript quote proves it | `process-recording`, `verifyTaskUpdates()` |
| No duplicate tasks when the same item comes up again | `dropRepeats()` |
| **Send tasks to Linear, Asana or Jira** with a personal token; only confirmed tasks go, each with its quote, timestamp and a link back | `supabase/functions/integrations`, `push-tasks`, `src/app/integrations.tsx` |
| Tracker tokens are write-only from the app: column privileges block reading them back | migration `…010000_phase2.sql` |
| **Meeting-to-deck**: client update, site report, pitch or proposal as a .pptx, from one recording or a whole project; decisions and next steps are copied from verified data, not rewritten | `supabase/functions/make-deck`, `_shared/deck.ts` |
| **Consent log**: told everyone / in the invite / only my voice, with the time, shown on the recording and in exports | `record.tsx`, `recordings.consent_method` |
| Menus and confirmations that work the same on iOS, Android and web | `src/components/ActionMenu.tsx`, `src/lib/dialog.ts` |

### Phase 2, batch 2

| Feature | Where |
| --- | --- |
| **Teams**: create a team, invite by email + code, roles (owner/admin/member), leave/remove | `src/app/team/[id].tsx`, `src/app/join.tsx`, Settings |
| **Team projects**: everyone in the team sees the project's recordings, transcripts, notes and tasks, can play the audio, tick and send tasks, and add their own recordings. Only a recording's creator can rename, move, re-run or delete it | migration `…020000_teams_and_api.sql` |
| Invites only work for the email they were sent to, once, within 14 days | `accept_invite()` |
| **MCP server** so Claude Code, Cursor and other MCP clients can search recordings, read notes and transcripts, list tasks and mark them done | `supabase/functions/mcp`, `_shared/mcp.ts`, `src/app/api-access.tsx` |
| Personal API tokens: stored as a hash, shown once, revocable, last-used date | `create_api_token()` |
| **Security rules tested on real Postgres**: outsiders see nothing; teammates see only team projects; the MCP server's scope matches the app's exactly | `supabase/tests/` (`npm run test:db`) |

### Phase 2, batch 3

| Feature | Where |
| --- | --- |
| **Claude.ai / ChatGPT connectors with sign-in** (OAuth 2.1): dynamic client registration, PKCE, single-use 10-minute codes, 1-hour access tokens bound to your MCP URL, 30-day refresh tokens rotated on every use with reuse detection, revocation | `supabase/functions/oauth`, `_shared/oauth.ts`, `src/app/oauth/authorize.tsx` |
| "Connected apps" list with disconnect | AI access screen |
| **Calendar sync** for Google Calendar and Microsoft 365: connect in Settings, refresh tokens kept server-side only | `supabase/functions/calendar`, `_shared/calendar.ts` |
| **Upcoming meetings + briefs**: next meeting on the home screen; each brief shows open tasks and last meeting's decisions and open questions for that project; one tap to record with title and project filled in | `src/app/upcoming.tsx`, `src/app/brief.tsx` |
| Meetings matched to projects automatically by name, or once per recurring series by you | `matchProject()`, `calendar_links` |

### Field mode and Procore

| Feature | Where |
| --- | --- |
| **Photos pinned to the moment**: tap *Take photo* while recording; the photo uploads with the recording (offline-safe) and shows in the transcript where it was taken | `src/lib/photos.ts`, `sync.ts` (photo ops), `record.tsx` |
| Photos are **linked to what was being said**: the nearest site-log entry or task said up to 15 s after or 45 s before the photo, never a guess by the AI | `assignPhotos()` in `_shared/field.ts` (+ tests) |
| **Daily site log** from site walks: weather, manpower, work completed, safety, issues by location, inspections, deliveries, delays. Every entry carries its quote; entries whose quote isn't in the transcript are shown dimmed and left out of exports | `verifySiteLog()`, `src/components/SiteLog.tsx` |
| **Field mode** (Settings): glove-sized buttons, big photo button, haptics, site walk as the default | `record.tsx` |
| **Words to listen for** per project (names, companies, products, site terms), plus names you gave speakers before, sent to Deepgram as key terms; falls back to plain transcription if rejected | project screen, `buildKeyterms()`, `transcribe()` |
| **Choose the microphone** while recording (e.g. a Bluetooth lapel mic); remembered for next time | `recorder.ts` |
| Site-report decks get a **Safety** slide and **photo slides** captioned with what was said | `make-deck`, `captionPhotos()` |
| PDFs include the site log and photos | `src/lib/export.ts` |
| **Procore**: sign in with Procore, pick a project; tasks become **punch items with their photos**; a site walk's log goes into the project's **Daily Log** (Notes) for that date, once | `supabase/functions/procore`, `_shared/procore.ts` (+ tests), `push-tasks` |

Still to come: phone-call recording, optional meeting bot, on-device transcription for no-signal sites, emailed team invites.

## Setup

You need: a Supabase project, an Anthropic API key, a Deepgram API key, Node 20+, and the [Supabase CLI](https://supabase.com/docs/guides/cli).

1. **Install**
   ```bash
   npm install
   cp .env.example .env    # then fill in your Supabase URL and anon/publishable key
   ```
2. **Database**: link the project and push the schema.
   ```bash
   supabase init            # only if supabase/config.toml doesn't exist yet
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
3. **Sign-in emails**: in Supabase → Authentication → Email Templates → *Magic Link*, make the email show the code, e.g. `Your code is {{ .Token }}`. The app asks for the 6-digit code.
4. **Server secrets** (never put these in `.env`):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... DEEPGRAM_API_KEY=...
   # optional overrides
   supabase secrets set CLAUDE_MODEL=claude-sonnet-5-5 DEEPGRAM_MODEL=nova-3
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically on hosted Supabase.
5. **Deploy the functions**
   ```bash
   supabase functions deploy process-recording
   supabase functions deploy ask
   supabase functions deploy integrations
   supabase functions deploy push-tasks
   supabase functions deploy make-deck
   supabase functions deploy mcp --no-verify-jwt       # its own tokens (API + OAuth)
   supabase functions deploy oauth --no-verify-jwt     # AI-connector sign-in
   supabase functions deploy calendar --no-verify-jwt  # provider redirects carry no session
   supabase functions deploy procore --no-verify-jwt   # same, for Procore's sign-in redirect
   ```
   Optional: `supabase secrets set APP_URL=https://your-web-app.example.com` so tasks sent to trackers link back to the recording.
6. **Run on a phone.** Background recording needs a development build (Expo Go won't keep recording when locked):
   ```bash
   npx expo run:ios        # or: npx expo run:android
   # or in the cloud: npx eas-cli@latest build --profile development
   ```
7. **Web app** (needed for Claude.ai/ChatGPT connectors and the calendar return page). On Vercel:
   ```bash
   node --env-file=.env scripts/hosting-config.mjs   # writes vercel.json with the rewrites below
   npx vercel --prod                                 # or connect the repo in the Vercel dashboard
   supabase secrets set APP_URL=https://your-app.example.com
   ```
   Set `EXPO_PUBLIC_APP_URL` to the same address in `.env`. The rewrites put `/mcp`, `/oauth/token|register|revoke` and the
   `/.well-known/oauth-*` discovery documents on your app's domain, which is what MCP connectors require. Other hosts: copy the
   rewrites from `vercel.json` into their equivalent (Netlify `_redirects`, Cloudflare Pages `_redirects`).

   Then in Claude: Settings → Connectors → Add custom connector → `https://your-app.example.com/mcp`. ChatGPT: add it as a
   connector in developer mode. You'll be asked to sign in and approve.
8. **Calendar** (optional). Register an app with each provider you want and set the secrets:
   - **Google**: Google Cloud Console → APIs & Services → enable *Google Calendar API* → OAuth consent screen (scope
     `calendar.readonly`) → Credentials → *OAuth client ID* (Web application). Authorized redirect URI:
     `https://YOUR-PROJECT.supabase.co/functions/v1/calendar/callback`.
     `supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...`
     Google requires app verification before the public can use calendar scopes; test users work right away.
   - **Microsoft**: Azure portal → Microsoft Entra ID → App registrations → New (accounts in any org + personal) → Web
     redirect URI as above → API permissions: *Calendars.Read*, *User.Read*, *offline_access* → Certificates & secrets → new
     client secret. `supabase secrets set MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...`
   - Optional: `supabase secrets set APP_SCHEME=murmur` if you rename the app's URL scheme.
9. **Procore** (optional). At [developers.procore.com](https://developers.procore.com) create an app, add a *Web Server*
   (authorization code) OAuth grant with redirect URI `https://YOUR-PROJECT.supabase.co/functions/v1/procore/callback`, then:
   `supabase secrets set PROCORE_CLIENT_ID=... PROCORE_CLIENT_SECRET=...`
   - Test against a Procore **sandbox** first: `supabase secrets set PROCORE_LOGIN_URL=https://sandbox.procore.com PROCORE_API_URL=https://sandbox.procore.com`
     (remove both for production).
   - Each Procore company must install your app (company admin → App Management) before its users can connect.
   - Users need Punch List (create) and Daily Log (Notes, create) permission in the chosen project.
   - Selling it to other Procore customers means listing on the Procore App Marketplace, which has its own review.
   Browser recordings upload during the session; if the tab is closed before upload finishes, that audio is lost (phones keep it on disk).

## Checks

```bash
npm run typecheck   # TypeScript, app code
npm run lint        # Expo / React hooks rules
npm test            # logic tests + database security tests (PGlite, no Docker needed)
cd supabase/functions && deno check */index.ts && deno test --allow-all _shared/
```

## Test on a real device before trusting it

The code compiles and bundles for iOS and Android, but it has not been run on a phone yet. Please try:

- [ ] Record 12+ minutes with the screen locked; confirm "parts saved" counts up and notes appear.
- [ ] Start recording, wait 6 minutes, force-quit the app. Reopen: you should see "Recording recovered" and get notes for at least the first 5 minutes.
- [ ] Record in airplane mode, stop, then turn the network back on. The recording should upload and process.
- [ ] Cover the mic for a minute: the silence warning should appear.
- [ ] Take a phone call mid-recording: the warning appears; "Restart mic" resumes.
- [ ] Import an MP3 and a phone video.
- [ ] Create a project, record a meeting with a commitment, then record a second meeting where someone says it's done. The first task should close with the quote.
- [ ] Connect Linear (or Asana/Jira), pick a team/project, and send tasks from a recording. Check the issue has the quote and link.
- [ ] Make a site report deck from a project and open it in PowerPoint/Keynote/Google Slides.
- [ ] Open the web build, sign in, record 30 seconds in the browser, and check notes appear.
- [ ] Two accounts: create a team, invite the second account, accept the code, record into a team project. The second account sees it; a third account sees nothing.
- [ ] Create an API token, add it to Claude Code with the copied command, and ask "what tasks are open on Riverside Lofts?"
- [ ] Deploy the web app, add `https://your-app/mcp` as a custom connector in Claude.ai, sign in and Allow, then ask Claude about a recording. Disconnect it in the app and confirm Claude loses access.
- [ ] Test the OAuth flow with the MCP Inspector too: `npx @modelcontextprotocol/inspector` → Streamable HTTP → your `/mcp` URL.
- [ ] Connect Google Calendar (as a test user), open Upcoming, link a recurring meeting to a project, open its brief, tap Record.
- [ ] A meeting where someone floats an idea ("we could…") and someone commits ("I'll send it Thursday"): the first should land in To review, the second in Open with the right owner.
- [ ] Field mode on, site walk: say "the guardrail on the east stair is loose", take a photo, keep walking. The log shows it under Safety with that photo; the transcript shows the photo at that moment.
- [ ] Take a photo mid-recording on iPhone and on Android: recording keeps going (timer, "parts saved"). If you see "Recording stopped by the system", tap Restart mic and note the phone model.
- [ ] Airplane mode: record, take 3 photos, stop. Turn the network back on: audio and photos upload, notes link the photos.
- [ ] Pair a Bluetooth headset or lapel mic, start recording, switch to it under "Mic". Check the audio came from it.
- [ ] Add your project's names and terms under "Words to listen for", record them being said, and compare the transcript with a recording made before.
- [ ] Procore sandbox: connect, pick a project, send a task with a photo (punch item has the photo attached), then "Add to daily log" (Notes entry on the right date). Sending again doesn't duplicate.
- [ ] Make a site-report deck from a site walk with photos; check the Safety and photo slides.

## Known limits

- **Procore** was built from Procore's public REST docs and tested with a fake server, not a real Procore company. Check the punch item and daily log links open the right page (Procore's web URLs change; set `PROCORE_APP_URL` if needed) and that photo attachments arrive.
- **Procore token renewal**: Procore issues a new refresh token on every renewal. Two Procore actions started at the same second could race and force a reconnect; rare, and the app says so when it happens.
- **No on-device transcription yet**: with no signal you still record and take photos; transcription runs when the phone is back online.
- **Noise**: Deepgram is given the audio as recorded. Phone noise suppression often hurts transcription, so it isn't switched on; a lapel mic and the project's words to listen for help most.
- **Photos added afterwards** (from the library) attach to the recording but aren't linked to entries, since there's no moment to match.

- **Model names**: defaults are `claude-sonnet-5-5` and Deepgram `nova-3`. Check both against the providers' current docs; change via secrets without redeploying the app.
- **Speaker labels** are assigned per 5-minute part, so "Speaker 1" in one part may be "Speaker 2" in the next. Fix later by joining parts server-side before transcription.
- **Rotation runs while the app is awake.** If the phone keeps it fully suspended, the current part simply grows until you stop; a crash in that state can lose that one part.
- **Long recordings**: processing runs as a background Edge Function task, which has a wall-clock limit (lower on Supabase's free plan). Very long recordings (2h+) may need the paid plan or a queue worker.
- **Upload size**: 5-minute parts are about 2.4 MB. Large imported files can hit Supabase Storage's per-file limit; raise it in Storage settings.
- **Tracker APIs** (Linear GraphQL, Asana REST, Jira Cloud REST v3) were written against their public APIs from memory and typechecked, not run against live accounts. Test each with a real token; error messages from the provider are shown in the app.
- **Carry-over only closes a task on a verified quote.** A wrong "done" is still possible if someone says it's done when it isn't; the task shows the quote and can be reopened with one tap.
- **MCP scope**: the AI tool sees your newest 1,000 readable recordings. Older ones aren't searchable through it yet.
- **OAuth and calendar were tested in pieces, not end to end against Claude.ai, Google or Microsoft.** The protocol logic, the database rules and the discovery chain are tested; the provider APIs and Claude's connector are not. Use the device checklist and the MCP Inspector before announcing it.
- **Team invites aren't emailed**: the admin gets a code to send however they like. Add an email provider (e.g. Resend) to send them automatically.
- **App Store**: Apple requires in-app account deletion before release; not built yet.
- **Recording law**: the notice reminder helps but isn't legal advice. Get counsel to review before launch, especially for phone calls.

## Project layout

```
src/app/                 screens (Expo Router)
  (tabs)/index.tsx       recordings list, Record + Import
  (tabs)/tasks.tsx       tasks across recordings
  (tabs)/settings.tsx
  record.tsx             type picker, recording notice, live recorder
  recording/[id].tsx     notes, transcript, tasks, ask, share
  sign-in.tsx
src/lib/                 recorder, sync queue, API, theme, types
src/components/          UI kit, TaskRow
supabase/migrations/     schema + security rules
supabase/functions/      process-recording, ask, shared logic + tests
desktop/                 Mac/Windows recorder (Electron), see desktop/README.md
```

## Desktop app

`desktop/` records online meetings on Mac and Windows with no bot in the call (mic + system
audio), using the same account and backend. Build and test steps, and what still needs a real
Mac/Windows check, are in [desktop/README.md](desktop/README.md).
