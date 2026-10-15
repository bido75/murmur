# Murmur — MVP

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

Not in this build (Phase 2 in the plan): task-tracker sync (Asana/Jira/Procore), meeting bot / desktop capture, calendar, web app, teams, meeting-to-deck export, phone-call recording, field-mode offline transcription.

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
   ```
6. **Run on a phone.** Background recording needs a development build (Expo Go won't keep recording when locked):
   ```bash
   npx expo run:ios        # or: npx expo run:android
   # or in the cloud: npx eas-cli@latest build --profile development
   ```

## Checks

```bash
npm run typecheck   # TypeScript, app code
npm test            # action-item verification tests (Node)
cd supabase/functions && deno check process-recording/index.ts ask/index.ts && deno test _shared/
```

## Test on a real device before trusting it

The code compiles and bundles for iOS and Android, but it has not been run on a phone yet. Please try:

- [ ] Record 12+ minutes with the screen locked; confirm "parts saved" counts up and notes appear.
- [ ] Start recording, wait 6 minutes, force-quit the app. Reopen: you should see "Recording recovered" and get notes for at least the first 5 minutes.
- [ ] Record in airplane mode, stop, then turn the network back on. The recording should upload and process.
- [ ] Cover the mic for a minute: the silence warning should appear.
- [ ] Take a phone call mid-recording: the warning appears; "Restart mic" resumes.
- [ ] Import an MP3 and a phone video.
- [ ] A meeting where someone floats an idea ("we could…") and someone commits ("I'll send it Thursday"): the first should land in To review, the second in Open with the right owner.

## Known limits

- **Model names**: defaults are `claude-sonnet-5-5` and Deepgram `nova-3`. Check both against the providers' current docs; change via secrets without redeploying the app.
- **Speaker labels** are assigned per 5-minute part, so "Speaker 1" in one part may be "Speaker 2" in the next. Fix later by joining parts server-side before transcription.
- **Rotation runs while the app is awake.** If the phone keeps it fully suspended, the current part simply grows until you stop; a crash in that state can lose that one part.
- **Long recordings**: processing runs as a background Edge Function task, which has a wall-clock limit (lower on Supabase's free plan). Very long recordings (2h+) may need the paid plan or a queue worker.
- **Upload size**: 5-minute parts are about 2.4 MB. Large imported files can hit Supabase Storage's per-file limit; raise it in Storage settings.
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
```
