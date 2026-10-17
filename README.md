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

### Sharing, search, privacy and the notetaker

| Feature | Where |
| --- | --- |
| **Search tab**: titles, notes and transcripts of everything you can see (yours and your teams’), matching words highlighted, plus matching tasks; **Ask** answers a question across all of it with links to the recordings | `src/app/(tabs)/search.tsx`, `search_recordings()` |
| **Share links**: read-only notes page, no sign-in; optional transcript; expiry; view count; turn off any time. Only confirmed tasks and checked decisions are shown | `src/app/share.tsx`, `src/app/s/[token].tsx`, `supabase/functions/share` |
| **Email recap** to attendees: summary, next steps, decisions, site log and a link; attendees BCC’d, replies go to you; 100 recipients a day per user | `share/recap`, `_shared/share.ts` (+ tests) |
| **Word export** (.docx), optionally with the transcript | `share/docx`, `_shared/docx.ts` |
| **Custom summary templates**: your own format on top of a built-in type, personal or shared with a team (admins); pick it when recording | `src/app/templates.tsx`, `summary_templates` |
| **Import from a link**: Dropbox, Google Drive, OneDrive share links and direct audio/video links. YouTube, Zoom and Teams links are refused with a reason (sign-in required, or downloading is against their terms) | `src/app/import-link.tsx`, `_shared/links.ts` (+ tests) |
| **Retention**: keep audio for 7 days to forever; keep whole recordings for 90 days to forever; a daily job deletes what's due | `src/app/privacy.tsx`, `supabase/functions/retention` |
| **Delete account** in the app (App Store requirement): files, data and login. Team projects pass to a teammate; refused if you're a team's only owner | `supabase/functions/account`, `prepare_account_deletion()` (+ tests) |
| **Consent link**: attendees open a page and agree or decline; answers show on the recording | `src/app/c/[token].tsx`, `supabase/functions/consent` |
| **State-aware warnings**: the record screen says when everyone must agree (13 all-party states, phone vs in-person nuances), using where you are and, for calls, where the other person is | `_shared/consent.ts` (+ tests) |
| **Optional notetaker bot** for meetings you can't attend (Zoom, Meet, Teams, Webex): joins under its own name, posts a recording notice in the chat, notes arrive like any recording; cancel or make it leave | `src/app/notetaker.tsx`, `supabase/functions/bot`, `_shared/recall.ts` (+ tests) |
| Recordings are kept out of Deepgram's model-training program (`mip_opt_out`) | `transcribe()` |

Still to come: phone-call recording, on-device transcription for no-signal sites, emailed team invites, Zoom cloud-recording import (needs a Zoom app).

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
   supabase functions deploy share --no-verify-jwt     # public share pages; other routes check the user
   supabase functions deploy consent --no-verify-jwt   # attendees aren't signed in
   supabase functions deploy account
   supabase functions deploy retention --no-verify-jwt # called by the daily schedule with CRON_SECRET
   supabase functions deploy bot --no-verify-jwt       # Recall's webhook; other routes check the user
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
10. **Email recaps** (optional). Create a [Resend](https://resend.com) account, verify your sending domain, then
    `supabase secrets set RESEND_API_KEY=re_... RECAP_FROM="Murmur <notes@yourdomain.com>"`. Without these the app says email isn't set up.
11. **Retention schedule.** `supabase secrets set CRON_SECRET=$(openssl rand -hex 24)`, enable the `pg_cron` and `pg_net`
    extensions (Dashboard → Database → Extensions), then run in the SQL editor (fill in your project ref and the secret):
    ```sql
    select cron.schedule('murmur-retention', '17 3 * * *', $$
      select net.http_post(
        url := 'https://YOUR-PROJECT.supabase.co/functions/v1/retention',
        headers := jsonb_build_object('x-cron-secret', 'YOUR_CRON_SECRET')
      );
    $$);
    ```
12. **Notetaker bot** (optional). Create a [Recall.ai](https://recall.ai) account and API key. In Recall's dashboard add a webhook
    to `https://YOUR-PROJECT.supabase.co/functions/v1/bot/webhook` for bot status events and copy its signing secret (starts with `whsec_`):
    `supabase secrets set RECALL_API_KEY=... RECALL_REGION=us-west-2 RECALL_WEBHOOK_SECRET=whsec_...` (optional `BOT_NAME="Acme Notetaker"`).
    Recall charges per bot hour. Zoom bots may need Recall's Zoom app setup for recording permission in some accounts.
13. **Share and consent links** open in the web app, so set `EXPO_PUBLIC_APP_URL` and `APP_URL` (step 7). Optional: `supabase secrets set APP_NAME=YourName`.
   Browser recordings upload during the session; if the tab is closed before upload finishes, that audio is lost (phones keep it on disk).
14. **Live transcript, translation, connections, automations, API.**
    ```bash
    supabase functions deploy live          # short-lived Deepgram keys for live captions
    supabase functions deploy translate
    supabase functions deploy connect --no-verify-jwt     # Slack/Salesforce/Google Docs/OneNote sign-in redirects
    supabase functions deploy export        # "Send notes to…"
    supabase functions deploy api --no-verify-jwt         # REST API (personal tokens)
    supabase functions deploy scheduler --no-verify-jwt   # automatic notetaker + weekly digest (CRON_SECRET)
    ```
    Sign-in apps (only for the ones you want to offer; the app hides the rest):
    - Slack: create an app with the `incoming-webhook` scope, redirect URL `https://YOUR-PROJECT.supabase.co/functions/v1/connect/callback` →
      `supabase secrets set SLACK_CLIENT_ID=... SLACK_CLIENT_SECRET=...`
    - Salesforce: a Connected App with OAuth scopes `api refresh_token`, same callback → `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`
      (optional `SALESFORCE_LOGIN_URL=https://test.salesforce.com` for a sandbox).
    - Google Docs and OneNote reuse the Google and Microsoft apps from step 8: add the same callback URL, and the `drive.file` (Google) and
      `Notes.Create` (Microsoft) permissions.
    Token connections (Notion, HubSpot, monday.com, ClickUp, Trello, Asana, Linear, Jira) need no server setup.
    Schedules (SQL editor, same pattern as step 11):
    ```sql
    select cron.schedule('murmur-autobot', '*/10 * * * *', $$ select net.http_post(url := 'https://YOUR-PROJECT.supabase.co/functions/v1/scheduler?job=autobot', headers := jsonb_build_object('x-cron-secret', 'YOUR_CRON_SECRET')); $$);
    select cron.schedule('murmur-digest', '5 * * * *', $$ select net.http_post(url := 'https://YOUR-PROJECT.supabase.co/functions/v1/scheduler?job=digest', headers := jsonb_build_object('x-cron-secret', 'YOUR_CRON_SECRET')); $$);
    ```
15. **Push notifications.** Run `npx eas init` to get an EAS project id (it's written to `app.json`), then
    `supabase secrets set EXPO_ACCESS_TOKEN=...` (Expo → Access tokens). For health data, also `PUSH_GENERIC_TEXT=1` (no titles on lock screens).
16. **Phone calls (Twilio)** — optional. Buy a voice number, then
    `supabase secrets set TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_PHONE_NUMBER=+1...` (optional `PHONE_ALLOWED_PREFIXES=+1,+44`,
    default `+1`). `supabase functions deploy phone --no-verify-jwt`, and set the number's "A call comes in" webhook (HTTP POST) to
    `https://YOUR-PROJECT.supabase.co/functions/v1/phone/voice`. Users link their mobile number and a PIN in Settings → Phone calls.
    Recordings are copied to your storage and deleted from Twilio.
17. **Aircall, devices, on-device transcription.**
    `supabase functions deploy aircall --no-verify-jwt` and `supabase functions deploy ingest --no-verify-jwt` (browser extension, watches,
    on-device transcripts). Then see `extension/README.md`, `watch/README.md`, `wear/README.md`. On-device transcription needs a development
    build (`npx expo run:ios` / `npx expo run:android`); it isn't available in Expo Go.
18. **Company controls.** `supabase functions deploy admin`, `supabase functions deploy export-data`, `supabase functions deploy scim --no-verify-jwt`.
    SAML single sign-on and SCIM setup: `docs/security/sso.md` — including turning on the access-token hook (Authentication → Hooks → `public.custom_access_token_hook`) so "SSO required" is enforced by the server. The security & compliance pack is in `docs/security/`.
19. **RingCentral** (optional). Create a REST API app (auth code flow) with the Read Call Log, Read Call Recording and
    Webhook Subscriptions permissions, redirect URL `https://YOUR-PROJECT.supabase.co/functions/v1/ringcentral/callback`;
    `supabase secrets set RINGCENTRAL_CLIENT_ID=... RINGCENTRAL_CLIENT_SECRET=...` (sandbox: `RINGCENTRAL_SERVER=https://platform.devtest.ringcentral.com`).
    `supabase functions deploy ringcentral --no-verify-jwt`, and renew its webhooks daily:
    ```sql
    select cron.schedule('murmur-ringcentral', '41 4 * * *', $$ select net.http_post(url := 'https://YOUR-PROJECT.supabase.co/functions/v1/ringcentral/renew', headers := jsonb_build_object('x-cron-secret', 'YOUR_CRON_SECRET')); $$);
    ```
20. **Long recordings and imports.** Processing hands over to a fresh run before the function time limit, so 2-hour+
    recordings finish on any plan; it needs `CRON_SECRET` (or `INTERNAL_SECRET`) set. Optional: `PIPELINE_BUDGET_MS`
    (default 240000; lower on the free plan, e.g. 120000) and `IMPORT_COPY_MAX_MB` (default 2000; files imported from
    links are copied into your storage). Raise Storage's project-wide file size limit to at least 5 GB.
21. **Zapier**: see `zapier/README.md` to publish the Zapier app.
22. **Desktop screen recording** needs nothing extra on Windows. On macOS, allow Murmur under System Settings → Privacy & Security →
    Screen & System Audio Recording.

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
- [ ] Search for a word said in a team recording, signed in as the teammate: it's found; as an outsider: nothing.
- [ ] Share a link, open it in a private browser window (no sign-in), turn it off, reload: "turned off". Try with transcript on.
- [ ] Email a recap to two addresses you own: both get it, neither sees the other, replying reaches you.
- [ ] Export Word with and without transcript; open in Word, Pages and Google Docs.
- [ ] Make a template ("Sections: Schedule, Budget, Risks"), record with it, check the notes follow it and tasks still have quotes.
- [ ] Import a Dropbox and a Google Drive link (shared publicly) and a direct .mp3 link. Paste a YouTube link: clear refusal.
- [ ] Set "keep audio" to 7 days on a test account, backdate a recording in the database, run the retention job: audio gone, notes kept.
- [ ] Delete a test account that owns a team project with a teammate: teammate keeps the project; the account can't sign in.
- [ ] Phone call with "other person in California": red warning. Send the consent link, answer it from another phone, see the answer on the recording.
- [ ] Send the notetaker to a test Meet and Zoom call: it joins as "Notetaker", posts the notice, notes arrive after you end the call. Cancel a scheduled one.
- [ ] Connect Slack (pick a channel), then "Send notes to… → Slack" on a recording. Do the same for Notion (share a page with the integration first), Google Docs and OneNote.
- [ ] HubSpot/Salesforce sandbox: log a meeting with an attendee email that matches a contact; check it's on the contact. Send tasks as HubSpot/Salesforce tasks.
- [ ] monday.com, ClickUp, Trello: connect, pick a board/list, send tasks.
- [ ] Automation "every site walk → email me + Slack": record a site walk; both arrive. Add a webhook to webhook.site and check the X-Murmur-Signature verifies.
- [ ] REST API: `curl` the recordings list with a personal token; mark a task done with PATCH.
- [ ] Topic alert "change order": say it in a recording; the push opens the transcript at that moment.
- [ ] Weekly digest on, then trigger `scheduler?job=digest` on a Monday morning in your time zone: one email.
- [ ] Automatic notetaker on with a calendar meeting that has a Zoom link 10 minutes out: a notetaker is scheduled once.
- [ ] Phone: link your mobile + PIN, call the Murmur number, wrong PIN twice then right PIN, dial a second phone you own. Both hear the notice; notes arrive; the recording is gone from Twilio's console.
- [ ] Aircall sandbox: set up the webhook, make a call, check it imports once (re-sent webhooks don't duplicate).
- [ ] Browser extension: link with a code, record a YouTube tab with your mic for 6 minutes (two parts), stop; notes arrive. Close the tab mid-recording: it finishes cleanly.
- [ ] Apple Watch / Wear OS (after building): link, record 2 minutes with the screen off, stop out of Wi-Fi range, then reconnect: it uploads.
- [ ] On-device transcription (iPhone and Android dev builds): download the model, record 6+ minutes, check no audio file appears in storage and notes arrive. On Android, force-quit mid-recording and reopen: the first part is still transcribed.
- [ ] Desktop: "Also record my screen", share a slide deck for 6 minutes, stop; "Watch screen recording" plays both parts.
- [ ] Admin console: turn off public links → existing links say "turned off"; set link max 7 days → new links expire in 7 days; require consent → recording into a team project needs a consent choice.
- [ ] Team retention 30 days on audio; backdate a team recording; run retention: audio gone.
- [ ] Audit log shows: invite, role change, link made/revoked, recording deleted, policy change.
- [ ] Verify a domain you own (TXT record) → a new account at that domain joins the team on sign-in.
- [ ] SAML SSO with an Okta developer account (docs/security/sso.md): "Continue with single sign-on" signs in. With "SSO required" and the hook on, an email code for that domain is refused, and a session signed in by code before turning it on ends within an hour.
- [ ] SCIM with Okta: assign a user → they appear as a member; unassign → removed; owners can't be removed.
- [ ] Export my data: open the ZIP; notes.md, transcript.txt, tasks.csv open cleanly; audio links download.
- [ ] A 2-hour recording (or a 2-hour import): it finishes; speakers keep the same number across the 5-minute joins.
- [ ] Desktop with computer audio: your words are labelled "Me", the others as separate speakers.
- [ ] Desktop: open a Google Meet call in Chrome; the "meeting detected" notice appears.
- [ ] Import a Google Drive file over 100 MB, then make the Drive link private: the recording still plays.
- [ ] Browser: record 5 minutes, close the tab, reopen the app: the first two-minute parts upload and get notes.
- [ ] Android on-device transcription: record 10 minutes with the screen off; a "Recording" notification shows and nothing is lost.
- [ ] Add a library photo taken during a site walk: it lands at its moment and links to the matching task.
- [ ] Highlight reel: add clips from two recordings, reorder, share; the public page plays each clip. Turn the team's public links off: the page empties.
- [ ] Ask Claude (connector) about a recording older than your 1,000 newest: it finds it.
- [ ] Invite a teammate by email (with Resend set up): they get the email with the code.
- [ ] RingCentral sandbox: connect, make a recorded call, it imports once.
- [ ] Zapier: connect with a token, turn on a "New Notes" Zap, record something: the Zap runs.

## What still needs doing outside the code

Everything identified as a gap has been built. What remains can't be done from code alone:

**Paid plans** — deliberately left for the production push (billing, in-app purchases, plan limits).

**Testing against the real services.** Everything was built from the providers' documentation and
tested with mocked responses; none has been run against a live account yet. The device checklist
above covers each one: Recall.ai, Slack, Salesforce, HubSpot, Notion, Google Docs, OneNote,
monday.com, ClickUp, Trello, Asana, Linear, Jira, Procore, Twilio, Aircall, RingCentral, Google and
Microsoft calendars, SAML SSO (and the access-token hook), SCIM clients, Claude.ai/ChatGPT
connectors, the Zapier app, and Deepgram/Anthropic on long recordings.

**Building on real devices.** The phone app's native projects, the on-device transcription and
foreground-service modules, the Apple Watch and Wear OS apps, and the desktop app's macOS helper
need their platform toolchains, which this environment can't download. The **Native builds**
workflow (`.github/workflows/native-builds.yml`) compiles all of them on GitHub's Mac and Linux
machines; run it once from the Actions tab, then try them on a phone, a watch and a Mac/PC.
The browser extension's tab capture needs a real click on its toolbar button to test.

**Decisions and reviews for people, not code:**
- *Recording-consent law*: the in-app guidance (13 all-party US states, phone vs in-person) is
  information, not legal advice. Have counsel review before launch, especially for phone calls.
- *SOC 2 / HIPAA*: the controls and documents are in `docs/security/`; the audit, the BAAs with
  each vendor and the policies are business steps (see `docs/security/soc2-readiness.md`).
- *Publishing*: App Store / Play Store listings, the Chrome Web Store listing, the Zapier app review.
- *Accounts and settings*: an EAS project id for push, provider app registrations (step 8 onward),
  and a Supabase plan whose limits fit (function time, storage file size).

**Design choices worth knowing (not defects):**
- Deepgram gets the audio as recorded (phone noise suppression tends to hurt transcription).
- A task is closed by a later recording only on a verified quote; a wrong "done" can still happen if
  someone says it's done when it isn't, and the task shows the quote and reopens with one tap.
- Speakers are matched across a long recording's 5-minute parts by the AI from what was said at
  each join; when it isn't confident it keeps them separate rather than merge two people. Renaming
  a speaker applies to the whole recording.
- macOS system-audio capture needs macOS 13 or newer (older Macs record the mic only).
- Bots that join meetings can be held in a waiting room or blocked by meeting settings; the app shows
  that status.
- YouTube links are refused on purpose: downloading from YouTube is against its terms.

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
