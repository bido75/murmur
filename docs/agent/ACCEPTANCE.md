# Acceptance criteria — wave.com parity for Murmur

Written by the product designer for task `#08c2803a`. It turns the one-line brief on
`#ff7df251` ("a wave.com replica") into journeys a tester can run and a pass/fail result
anyone can check.

**Product promise (from `docs/agent/PROJECT_RULES.md`):** *never lose a recording, and every
note/task can be checked against what was actually said.* Every criterion below is written so
that it either serves that promise or is explicitly labelled as not doing so.

**How to read a journey**

| Field | Meaning |
| --- | --- |
| **id** | Journey id. `M*` = Must, `S*` = Should, `L*` = Later. |
| **Steps** | What a tester does, in order. |
| **Owned by** | The real screen/file in this repo that implements it. If a file does not exist yet, it says so. |
| **Pass condition** | Something a tester can *observe*. Not "works well" — a visible state, a number, a row. |

**Test setup for every journey:** a Supabase project with the schema pushed, `process-recording`,
`ask`, `share`, `live`, `export` and `account` deployed, `EXPO_PUBLIC_APP_URL` set to the web app
address, and a signed-in user. Phone journeys need a development build (`npx expo run:ios` /
`npx eas build --profile development`); Expo Go will not keep recording with the screen locked.

---

## Scope of this build (agreed with the team lead)

QA verifies this build against **M1–M5** plus the two honesty fixes below. The rest of the file
is the longer-term target and is **not** part of this build's pass/fail bar.

**In this build, in this order**

| Order | Item | Gap id | Where |
| --- | --- | --- | --- |
| P0 | Real audio player bar on the recording screen | G1 | `src/app/recording/[id].tsx` |
| P0 | Key-point source times + timestamp chips | G2 | `src/lib/types.ts`, `_shared/prompts.ts`, `recording/[id].tsx` |
| P0 | Smaller loss window | G6 | `src/lib/recorder.ts`, `src/lib/webStore.ts` |
| P1 | Copy as rich text | G3 | `src/lib/dialog.ts`, `src/app/share.tsx` |
| P1 | Share-link honesty (see below) | G7 | `src/app/share.tsx`, `_shared/share.ts` |
| P1 | Live-transcript "web only" label | G5 | `src/app/record.tsx` |

**Two honesty fixes are in this build because they are false promises to users, not missing features.**
They are part of M1 and S1 respectively and QA should fail the build if either is still wrong:

- **H1 — the record screen's loss promise** (`src/app/record.tsx:279`, "Audio is saved every 5
  minutes, so nothing is lost if your phone dies"). On web the real figure is 2 minutes. After
  G6 the copy must match the actual part length on each platform.
- **H2 — the share screen's claim** (`src/app/share.tsx:115`, "Only confirmed tasks and checked
  decisions are shown; nothing waiting for review"). Unverified key points are copied through to
  the public link. After G7 the copy must be true, or the key points must be verified.

**Out of this build**

- **Billing (G4 / S4)** — moved to its own task `#f1d58634` (entitlements migration + RLS + test,
  RevenueCat and Stripe webhooks, minutes meter with an 80 % warning, limit behaviour that never
  drops audio, two-tap cancel, behind a feature flag). It is **not** part of this build's
  acceptance bar. QA should not fail this build for a missing minutes meter.
- **G9 (Ask answers have no citations)** — logged as a follow-up, out of scope here.
- **Phone live transcription** — a follow-up. M2 stays **web-only** for this build, under the
  promotion rule below; the phone UI must say so rather than imply phone support.

---

## The 5 Must journeys

These five decide whether this counts as a wave.com replica. If any one of them fails, it does not.

| # | Journey | Why it is a Must |
| --- | --- | --- |
| M1 | Capture a meeting end to end and never lose the audio | Wave's first promise is that the capture always works. Everything else depends on having audio. |
| M2 | Live transcript while recording | Wave's signature screen is live captions next to a running timer. It is what "AI note taker" looks like in the hand. |
| M3 | Editable summary notes | Wave's output is an editable document, not a read-only transcript. AI output the user cannot correct is a demo, not a product. |
| M4 | Action items that carry a transcript quote | The `verify.ts` rule is the whole safety argument: no task without a quote that exists in the transcript. |
| M5 | Timestamp chips + a real audio player that scrubs and follows the transcript | Wave's defining interaction: every point in the notes is a link into the audio. This is Roadmap Milestone 1 items 1 and 2. |

`S1` (share link) is listed as Should rather than Must because it is reach, not the product
promise — but if the goal is to *sell* a wave.com replica, **S4 (billing/minutes meter) is
promoted to Must**. See "Promotion rules" at the end.

**For this build, QA's verdict is per Must journey: pass / fail / not verifiable.** M2 is
web-only for this build (see "Scope of this build"), so a phone live-transcript result should be
recorded as "not applicable — web only", not as a failure.

---

## Must

### M1 — Capture a meeting end to end and never lose the audio

**Steps**
1. Open the app (Home, `src/app/(tabs)/index.tsx`) and tap **Record**.
2. On `src/app/record.tsx`: pick a template, pick a project (or skip), answer the consent
   question, tap **Start recording**.
3. Talk for at least 6 minutes, letting the screen lock once.
4. Tap **Stop** and confirm.
5. Watch the recording screen change from "Waiting to upload" to a Notes tab with an overview.

**Owned by**
- `src/app/record.tsx` — the screen, the consent gate, the live timer, the "parts saved" counter (line 306).
- `src/lib/recorder.ts` — `useSegmentedRecorder`: segments, pause/resume, mic health checks, crash recovery.
- `src/lib/config.ts:10` — `SEGMENT_MS = 5 min` (phone part length).
- `src/lib/sync.ts` — the upload queue; local audio is deleted only after the upload is confirmed (PROJECT_RULES rule 6).
- `supabase/functions/process-recording/index.ts` — transcription + notes.

**Pass condition**
- While recording, the text under the timer reads **"N parts saved safely"** and N increases at least once (part boundary crossed).
- After Stop, the Home list shows the recording, and opening it shows a Notes tab with an overview and key points — not "Writing your notes…" indefinitely (10 min ceiling on a 6-minute recording).
- **Crash test:** start recording, wait 6 minutes, force-quit the app, reopen → a "Recording recovered" recording exists and its notes cover at least the first completed part.
- **Offline test:** record in airplane mode, stop, restore the network → the recording uploads and processes, and the local file is not deleted before the upload is confirmed.
- **Silence test:** cover the mic for 60 s → the banner "Not hearing anything for a while" appears.

---

### M2 — Live transcript while recording

**Steps**
1. On the **web** app (`npx expo start --web`), open **Record** and start recording.
2. Tap **Show live transcript** on the live screen.
3. Speak normally for 30 s.
4. Tap **Hide**.

**Owned by**
- `src/app/record.tsx:328-341` — the live panel (web only, `isWeb`).
- `src/lib/live.ts` — `startLive`: opens a second mic stream, streams to Deepgram over a websocket, `mergeLive` keeps the last 8 lines.

**Pass condition**
- Within about 2 s of speaking, words appear in the **LIVE TRANSCRIPT · draft** panel.
- Interim lines are grey; finished lines are solid. Faded-out text is replaced, not duplicated.
- Tapping **Hide** removes the panel and the recording keeps running (the timer does not reset).
- If the live service is unavailable, a message appears **and the recording continues** — the live transcript is never allowed to break capture.

**Note:** this journey is **web-only for this build** (see Gap G5). Agreed for this build: the
phone build must **say so** — the record screen must not imply phone live transcription. The
accepting behaviour is either (a) the live panel exists on phone, or (b) the phone record screen
labels live transcript as **web only**. Phone live transcription itself is a logged follow-up.

---

### M3 — Editable summary notes

**Steps**
1. Open a processed recording (`src/app/recording/[id].tsx`), **Notes** tab.
2. Read the overview, key points, decisions and open questions.
3. Tap **Edit notes**.
4. Change the overview and one key point, tap **Save**.
5. Reopen the recording.

**Owned by**
- `src/app/recording/[id].tsx` — `Notes` component; the edit form is lines 582-598, the save path is `updateSummary` (line 559).
- `src/lib/api.ts` — `updateSummary`.
- `supabase/functions/_shared/notes_data.ts` — the persisted summary shape.

**Pass condition**
- The Notes tab shows an overview, **Key points**, **Decisions** and **Open questions** sections (any of them may be absent when the meeting had none).
- After Save, the edited text is what is shown, and it survives closing and reopening the recording.
- Editing the notes does **not** delete or alter the quotes on decisions or tasks — the screen says so at line 591 and it must stay true.
- A non-owner (a teammate) sees the notes but the **Edit notes** button is not shown (`canEdit` at line 601).

---

### M4 — Action items carry a transcript quote (the `verify.ts` rule)

**Steps**
1. Record a meeting where one person commits ("I'll send the revised quote by Thursday"), one
   person floats an idea ("we could add a second site"), and one task names an owner who is
   never mentioned in the recording.
2. Open the recording, **Tasks** tab.

**Owned by**
- `supabase/functions/_shared/verify.ts` — `verifyActionItems`, `findQuote`, `ownerMentioned`.
- `supabase/functions/_shared/pipeline.ts:152` — where the model output is passed through `verifyActionItems`.
- `supabase/functions/_shared/prompts.ts` — the summary prompt that demands a word-for-word quote.
- `src/components/TaskRow.tsx` — how the task, quote, time and review state are rendered.
- `src/app/recording/[id].tsx:508-526` — the Tasks tab.

**Pass condition**
- Every task shows an **italic quote** and a time next to it (`TaskRow.tsx:65-71`). A task with no quote text is a bug.
- Tapping the quote seeks the audio to that moment.
- A task the transcript does not support shows the amber row **"Couldn't find this in the transcript"** with **Keep** and **Dismiss** (`TaskRow.tsx:73-83`), and the Tasks tab label counts it (`Tasks (3!)`, `recording/[id].tsx:460`).
- A suggestion ("we could…") shows **"Only suggested, not agreed"**.
- A task whose named owner is never said in the transcript shows **"Owner unclear"**.
- A commitment that is well supported shows **no** review row — it goes straight to Open with the right owner.
- The tab footer reminder "AI-generated from the transcript. Check important details against the audio." is present (line 719).

---

### M5 — Timestamp chips + a real audio player that scrubs and follows the transcript

**Steps**
1. Open a recording with more than 5 minutes of audio, **Transcript** tab.
2. Tap a decision quote on the **Notes** tab, then a task quote on the **Tasks** tab.
3. Use the player bar: pause, scrub, skip back 15 s, skip forward 30 s, change speed.
4. Keep the audio playing and watch the transcript.

**Owned by**
- `src/app/recording/[id].tsx` — `playAt(ms)` (lines 74-104) is the only playback that exists today; `TranscriptView` (755-810) renders the transcript.
- `src/components/SharedAudio.tsx` — the player used on **share** pages (a native `<audio>` element on web, a plain "Play" button on phones).
- `src/lib/format.ts` — `clock()` for the time labels.

**Pass condition**
- A **sticky player bar** is visible while a recording with audio is open, containing: play/pause, a scrubber, elapsed and total time, **skip back 15 s**, **skip forward 30 s**, speed **0.75× / 1× / 1.25× / 1.5× / 2×**, and the current speaker.
- Every control has an accessible label (a screen reader announces "Skip back 15 seconds", not "button").
- Dragging the scrubber moves the audio; the elapsed/total numbers update.
- The line currently being spoken is **highlighted**, and the transcript **scrolls to follow** it.
- Tapping a decision's time chip or a task's quote seeks to that moment and plays from it.
- Playback crosses a 5-minute part boundary correctly (the segment→offset mapping already exists in `playAt`).
- If the audio was removed by the retention setting, the screen says so plainly instead of failing silently (`recording/[id].tsx:77-79`).

> This journey is **not implemented today**. See Gap G1 (no player bar) and Gap G2 (no time source on
> key points). It is Roadmap Milestone 1 items 1 and 2.

---

## Should

### S1 — Share link (read only, no sign-in)

**Steps**
1. On a recording, **···** → **Share, email or export** (`src/app/share.tsx`).
2. Turn on "Include the transcript" / "Let people play the audio" / "Let people ask questions", set an expiry, tap **Create link and copy**.
3. Open the link in a private browser window with no session.
4. Come back and tap **Turn off**, then reopen the link.

**Owned by** `src/app/share.tsx`, `src/app/s/[token].tsx`, `supabase/functions/share/index.ts`, `supabase/functions/_shared/share.ts`.

**Pass condition**
- The link opens with **no sign-in** and renders the notes.
- Only **verified** decisions and **confirmed** tasks appear. A task sitting in review does **not** appear.
- The transcript appears only when the toggle was on; the audio player appears only when audio was allowed.
- With a password set, the link asks for it before showing anything.
- After **Turn off**, reloading shows "turned off" and no notes.
- The link records a view count (`l.views` in the list).

---

### S2 — Export (Word / PDF / text) and rich text copy

**Steps**
1. On `src/app/share.tsx`, **Export** card.
2. Tap **Word (.docx)**, open the file in Word / Google Docs / Pages.
3. Tap **PDF** (web opens the print dialog; "Save as PDF").
4. Tap **Text**.
5. Copy the notes on web and paste into Google Docs and Word.

**Owned by** `src/app/share.tsx:192-199`, `supabase/functions/_shared/docx.ts`, `supabase/functions/export/index.ts`, `src/lib/export.ts`, `src/lib/dialog.ts`.

**Pass condition**
- The `.docx` opens in Word or Google Docs with **real headings and bulleted lists**, not one flat paragraph of text. It contains the title, date, overview, action items as a table (text / owner / due / quote), decisions and open questions.
- Turning on "Word file includes the transcript" adds the transcript with speakers and timestamps.
- The PDF prints with the same structure and includes the photos that were taken.
- **Rich text:** copy the notes on web → paste into Word, Google Docs, OneNote and Notion → **headings and bullets survive**. This needs `ClipboardItem` with `text/html` + `text/plain`; today `shareOrCopy` writes plain text only (`src/lib/dialog.ts`).

---

### S3 — Search and ask over your history

**Steps**
1. **Search** tab (`src/app/(tabs)/search.tsx`).
2. Type a word that was said in a meeting → read the results.
3. Tap a result.
4. Type a question and tap **Ask**.

**Owned by** `src/app/(tabs)/search.tsx`, `supabase/functions/ask/index.ts`, `supabase/functions/_shared/prompts.ts` (`ASK_SYSTEM`), `supabase/functions/_shared/verify.ts` (`formatTranscript`).

**Pass condition**
- Typing a word said in a meeting returns that recording with a **snippet where the matched words are highlighted**, and the moment it was said ("said at 4:12").
- Tapping a result opens the recording **on the transcript at that moment** (the `t` route param, `recording/[id].tsx:28`).
- Tasks are searchable too, and a task hit shows its owner, due date and source recording.
- **Ask** returns an answer and lists the recordings it came from; tapping a source opens that recording.
- A teammate sees results for team recordings; an outsider sees nothing.

---

### S4 — Billing and a minutes meter

> **Out of this build.** Moved to its own task `#f1d58634` (nova). Kept here so the criteria exist
> in one place and are ready to verify when that task lands. **QA must not fail this build for a
> missing minutes meter.**

**Steps**
1. Home (`src/app/(tabs)/index.tsx`) → check the minutes meter.
2. Record until usage passes 80 % of the free allowance → check the warning.
3. Pass the limit → try to record again.
4. Settings (`src/app/(tabs)/settings.tsx`) → upgrade, then cancel.

**Owned by** — **nothing exists yet.** Needs: an `entitlements` table (new migration + RLS + tests under `supabase/tests/`), RevenueCat for iOS/Android and Stripe for web writing one `entitlements` row per user via webhook, a minutes meter on Home, and a two-tap cancel in Settings.

**Pass condition**
- Home shows "**X of Y minutes used**" for the current period.
- At 80 % a warning appears on Home.
- At the limit **recording still works and the audio is still saved**; only processing is queued until the user upgrades or the allowance resets.
- Upgrading takes effect without a reinstall (the webhook row is read by the app).
- Settings offers one free tier and one paid plan, monthly or yearly, and **no weekly plan**.
- Cancelling takes two taps.
- The provider secret never appears in the app bundle (only in Supabase secrets).

---

### S5 — A task discussed in a later meeting closes with a quote

**Steps**
1. Record meeting 1 with a commitment. Leave the task open.
2. Record meeting 2 where someone says it is finished.
3. Open meeting 2's Notes tab → **Earlier tasks discussed**.

**Owned by** `supabase/functions/_shared/verify.ts` (`verifyTaskUpdates`, `dropRepeats`), `supabase/functions/_shared/pipeline.ts:164`, `src/app/recording/[id].tsx:650-670`, `src/components/TaskRow.tsx` (`completion_quote`).

**Pass condition**
- Meeting 2's Notes tab shows **"Earlier tasks discussed"** with the task, the new status and the quote from meeting 2.
- The task on meeting 1 is closed and shows **"Closed in a later meeting: “…”"**.
- A task update whose quote cannot be found in meeting 2's transcript leaves the task **open** and says so ("not found in transcript, task left open").
- A task mentioned but not discussed is not reported as done.

---

## Later

These exist in the repo or are easy to add, but they are not what decides wave.com parity.

| id | Journey | Owned by | Pass condition |
| --- | --- | --- | --- |
| L1 | Highlight reels / clips | `src/app/reels/index.tsx`, `src/app/reels/[id].tsx`, `recording/[id].tsx` long-press "Add to a highlight reel…" | A clip from a transcript line can be collected into a reel and replayed |
| L2 | Follow-up email draft | `src/app/followup.tsx`, `_shared/followup.ts` | A draft recap is generated from the verified material and editable |
| L3 | Slide deck from a recording | `src/app/deck.tsx`, `_shared/deck.ts`, `make-deck` | A .pptx opens in PowerPoint/Keynote/Slides with the notes |
| L4 | Meeting brief from the calendar | `src/app/brief.tsx`, `src/app/upcoming.tsx` | The brief shows open tasks before the meeting starts |
| L5 | Templates | `src/app/templates.tsx`, `src/lib/templateLibrary.ts` | A custom template changes the sections the notes ask for |
| L6 | Translation of notes + transcript | `recording/[id].tsx` **Translate…**, `translate` function | Notes and transcript switch language; **quotes stay in the original words** (line 444) |
| L7 | Notetaker bot (opt-in) | `src/app/notetaker.tsx`, `_shared/recall.ts`, `bot` function | A notetaker joins only the meeting the user opted into (PROJECT_RULES rule 7) |
| L8 | Team admin, integrations, automations, alerts | `src/app/team/*`, `src/app/integrations.tsx`, `src/app/automations.tsx`, `src/app/alerts.tsx` | Each works; they are untested against live accounts (PROJECT_RULES rule 10) |
| L9 | Connector surfaces (MCP/API, desktop, extension, watch, wear, Zapier) | `src/app/developers.tsx`, `src/app/api-access.tsx`, `mcp`/`api` functions, `desktop/`, `extension/`, `watch/`, `wear/`, `zapier/` | Each surface can ask about a recording and gets a cited answer |

---

## Gaps found in the current code

Information for the engineer. Not tasks for the designer.

| id | Gap | Where | Impact |
| --- | --- | --- | --- |
| **G1** | **No real audio player.** `playAt()` loads one segment, seeks and plays. There is no play/pause control, no scrubber, no ±15/30 s skip, no speed control, no speaker readout, and no transcript-follow highlight. `useAudioPlayer` is used but its position is never read. | `src/app/recording/[id].tsx:35-104` | Blocks **M5** entirely. Roadmap Milestone 1 item 1, 0 % done. |
| **G2** | **Key points have no time source.** `key_points` is `string[]` — plain strings. The model is not asked for a quote or a time for them, so no chip can exist. Decisions (`Decision.quote_ms`) and tasks (`Task.quote_ms`) do carry times. | `src/lib/types.ts:60`, `supabase/functions/_shared/prompts.ts:75-80`, `recording/[id].tsx:631-634` | Blocks the "every key point is a link into the audio" half of **M5**. Roadmap Milestone 1 item 2 is ~40 % done (decisions and tasks only). |
| **G3** | **No rich-text copy.** `shareOrCopy` writes plain text with `navigator.clipboard.writeText`. There is no `ClipboardItem` with `text/html`, and no "Copy notes" button anywhere in the app — only Word/PDF/Text export. | `src/lib/dialog.ts`, `src/app/share.tsx:192-199` | Blocks the rich-text half of **S2**. Roadmap Milestone 1 item 4, 0 % done (the `.docx` half of that item is done). |
| **G4** | **Billing does not exist at all.** Grepping `src/`, `supabase/functions/` and `supabase/migrations/` for `entitlement`, `stripe`, `revenuecat`, `billing`, `plan` or `minutes_used` returns no application code. There is no `entitlements` table, no minutes meter on Home, no warning at 80 %, no limit behaviour and no cancel path. | missing entirely | Blocks **S4**. Roadmap Milestone 1 item 6, 0 % done. **Biggest single gap in the repo.** → **Moved to task `#f1d58634`; out of this build.** |
| **G5** | **Live transcript is web-only.** The live panel is behind `isWeb`, and `src/lib/live.ts` uses `navigator.mediaDevices` + `MediaRecorder`, which do not exist on a phone. | `src/app/record.tsx:328`, `src/lib/live.ts:38-54` | **M2** can only be claimed on web. → **In this build:** the phone UI must say "web only" (see M2 note). Phone live transcription is a follow-up. |
| **G6** | **The loss window is bigger than the app claims, and the copy is wrong on web.** Phone parts are 5 min (`SEGMENT_MS`), web parts are 2 min (`WEB_SEGMENT_MS`). The record screen says "Audio is saved every 5 minutes, so nothing is lost if your phone dies" — on web the real number is 2. `src/lib/webStore.ts` stores only **completed** blobs; there is no `MediaRecorder.start(timeslice)` 5 s slicing. | `src/lib/config.ts:10`, `src/lib/recorder.ts:38`, `src/app/record.tsx:279`, `src/lib/webStore.ts` | A web tab crash loses up to 2 minutes. Roadmap Milestone 1 item 3, 0 % done. Either shorten the window or fix the copy. → **In this build** (P0), including honesty fix **H1**. |
| **G7** | **Unverified material reaches a public link.** The share screen promises "Only confirmed tasks and checked decisions are shown; nothing waiting for review", but key points are copied through unfiltered and can never be verified (they have no quote). | `src/app/share.tsx:115`, `supabase/functions/_shared/share.ts:58-59` | A public link can show a key point the transcript never supported. Either verify key points (G2) or label them in the share view. → **In this build** (P1), including honesty fix **H2**. |
| **G8** | **Edited key points are never re-checked.** `updateSummary` writes the overview, key points and open questions the human typed, with no quote and no re-verification, and the UI states that decisions and tasks keep their quotes while key points do not. | `src/app/recording/[id].tsx:554-567`, `src/lib/api.ts` `updateSummary` | A human can edit a key point into something nobody said. It is the user's own edit, so it is defensible — but it weakens "every note can be checked against what was actually said". Consider marking hand-edited notes. |
| **G9** | **Ask answers have no citations.** The `ask` function returns only `recording_id` and `title` per source — no timestamp, no quote. | `supabase/functions/ask/index.ts` (sources mapping), `src/app/(tabs)/search.tsx:88-97` | An AI answer cannot be checked against what was said. Search hits do carry a time, so the gap is only in the ask path. → **Follow-up; out of scope for this build.** |

---

## Promotion rules

- **S4 (billing/minutes meter) becomes a Must** the moment anyone can pay. Until then it is Should.
  → For this build it is **out of scope** (task `#f1d58634`).
- **M2 becomes a Must on phones** the moment the live panel ships on mobile (see G5). Right now it is a Must on web and unclaimed on phone. → For this build it stays **web-only**, with a "web only" label on phone.
- **S1 (share link) becomes a Must** if "wave.com replica" is judged on a demo that ends with sharing a link.
- **M5 splits** if the player bar (Roadmap item 1) lands but key-point times (Roadmap item 2) do not: player bar alone is not enough — the promise is that a **note** can be checked against the audio, and key points are the notes people read.

## Definition of done for this build

**M1, M2 (web), M3, M4 and M5 all pass**, using the tester steps above, plus:

- **H1** — the record screen's loss promise matches the real part length on each platform.
- **H2** — the share screen's "only confirmed tasks and checked decisions" claim is true.
- The phone record screen says live transcript is **web only**.
- `verify.ts` unit tests green (`supabase/functions/_shared/verify.test.ts`) and the checks in
  `docs/agent/PROJECT_RULES.md` all passing.

## Definition of done for "this is a wave.com replica" (longer term)

All five Must journeys pass on **web** and on **one physical phone build** — including phone live
transcription and the billing/minutes meter — with the checks in `docs/agent/PROJECT_RULES.md`
all passing.

---

## How to report a verdict

QA reports one line per Must journey, then a defect list, then a gap list. Keep it factual —
"not verifiable in this environment" is a valid verdict and is better than a silent pass.

```
M1  <pass | fail | not verifiable>   <one line of evidence>
M2  <...>   (web only for this build — phone is "not applicable")
M3  <...>
M4  <...>
M5  <...>
H1  <...>
H2  <...>
```

Each defect: **id · severity (blocker/major/minor) · journey id · file:line · steps to reproduce ·
expected vs actual · suggested fix direction.**

Each gap: what could not be checked, and what evidence would be needed (device, live Supabase
project, deployed function, provider account). A journey that needs a live Supabase project, a
real device build or a deployed edge function is **not verifiable** without it — say so instead of
marking it passed.

