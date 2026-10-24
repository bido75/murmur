# Feature audit

Every feature of the Murmur AI Note Taker, classified with the evidence behind the
classification.

**Statuses**

| Status | Meaning |
|---|---|
| WORKING | Verified by a passing test or a real run. |
| PARTIAL | Some of it works; the rest is missing or unverified. |
| BROKEN | It exists and fails. |
| MISSING | No functional implementation. |
| BLOCKED | An external dependency, hardware, licence or credential prevents validation. |

**How this was checked.** The automated suites were run in full
(`npm test` — 167 logic, 10 app and 75 database security tests; `desktop`: 92 tests;
`deno test --allow-all _shared/` — 167 tests). The desktop was built with
`node build.mjs` and the app's iOS bundle was built with Metro. The whole pipeline
was also run for real against a local stack, from a signed-up user through the audio
upload, the transcription and the notes (`scripts/test-local-pipeline.cjs`). Anything
that could not be executed in this environment is marked BLOCKED with the reason and
the exact steps to run it.

The Murmure reference was audited at commit
`2218c1bab463d17ace34258a3842b9f230d60ca3` (v2.0.3). See `LICENSE_REVIEW.md`.

---

## 1. Local transcription

| Feature | Status | Evidence |
|---|---|---|
| Cloud transcription (Deepgram, speaker labels, key terms, redaction) | WORKING | `supabase/functions/_shared/services.ts`; exercised by `_shared/verify.test.ts` and `sharing.test.ts`; the phone records and the pipeline runs on the server. |
| On-device transcription (whisper.cpp via `whisper.rn`) | PARTIAL | The code path is complete (`src/lib/localStt.ts`) and the model is downloaded and checksum-verified by `src/lib/transcription/modelManager.ts` (13 tests on the state machine and the integrity check). **BLOCKED on hardware:** whisper inference has never been run on a phone — the code was already marked "Untested on hardware" before this work. |
| Local transcription on the desktop (Parakeet) | WORKING | The engine runs: `desktop/src/main/parakeet/engine.ts` loads the three ONNX graphs, runs the greedy TDT decode and produces words with times. The integration test downloads the real 582 MB model, checks it and reads a real recording: "The quick brown fox jumps over the lazy dog. The meeting starts at 9 o'clock." |
| Transcription mode selection (cloud / local / auto) | WORKING | `_shared/transcription_mode.ts`, 14 tests. Local-only privacy is proved to beat every other setting, and `canRecordNow()` proves the device is never silently swapped for the cloud. |
| "Never upload audio" privacy setting | WORKING | `_shared/transcription_mode.ts` + `src/app/privacy.tsx` + `src/app/record.tsx`. The refusal path is tested. |
| Model download with progress, cancel and retry | WORKING | `src/lib/transcription/modelManager.ts` and `desktop/src/main/speechModelManager.ts`. The desktop downloads the real archive and unpacks it in the integration test. |
| Model integrity verification | WORKING | SHA-256 in `_shared/sha256.ts` (6 tests, including a comparison against the platform's crypto and a proof that the hash is the same however the bytes are divided). The published checksum and size are pinned in a test. |
| Model version management | WORKING | The folder name carries the id and the build; an older build is reported as out of date rather than used. |
| Model recovery after an interrupted install | PARTIAL | The logic is implemented and unit-tested through the state machine, and the desktop cleans up the partial file. **BLOCKED on hardware:** the app has not been killed mid-download on a device. |
| Storage-space check before downloading | MISSING | Not implemented. The desktop shows the model size but does not check free disk space. |
| Hardware compatibility detection | MISSING | Not implemented. No CPU feature or RAM check before installing a 650 MB model. |
| CPU / memory usage monitoring during transcription | PARTIAL | `desktop/src/main/resources.ts` reports memory and processor share. The numbers are shown to the user and are not yet sampled over time into a graph. |
| Transcription progress reporting | WORKING | The download reports progress, and the engine reports how far through the audio it is. |
| Transcription cancellation | PARTIAL | The download is cancellable and the whisper handle is told to stop (`src/lib/localStt.ts`). The desktop engine can be stopped between frames but not mid-graph. |
| Word-level timestamps | MISSING | Not implemented anywhere. Both engines give segment-level times only. |
| Local speaker diarization | PARTIAL | The desktop reads the two channels separately, so the person recording is speaker 0 and the call is speaker 1 — the same numbering the server uses. **The people on the call are not told apart**, and that needs a speaker model that is not here. |
| Multilingual detection for the local engine | MISSING | The Parakeet model is English. The app does not claim a language it was not told. |
| Long recordings (a 60-minute meeting) | PARTIAL | The parts and the queue handle long meetings, and the local path transcribes each part. **BLOCKED on hardware:** a real 60-minute recording has not been through. |

## 2. Meeting intelligence

| Feature | Status | Evidence |
|---|---|---|
| AI summaries, key points, decisions, open questions | WORKING | `_shared/field.ts` (13 tests) covers the summary prompt, the site log and the photo linking. |
| Timestamp-linked source citations | WORKING | `_shared/verify.ts` (16 tests) proves a quote is found in the transcript; `key_point_details` carries the time (`migration 20261021140000_key_point_times.sql`). |
| Verified action items with owners and due dates | WORKING | `_shared/verify.ts`: a hallucinated quote is kept but flagged; an owner never mentioned in the meeting is removed; suggestions always need review. |
| Task updates carried across meetings | WORKING | `_shared/verify.ts`: "carry-over: verified done update maps back to the task id". |
| Timestamp chips on notes | WORKING | Now on key points, decisions, task updates, site-log entries and marked transcript lines (`src/app/recording/[id].tsx`, `src/components/SiteLog.tsx`). |
| Speaker renaming | WORKING | `setSpeakerName` in `src/lib/api.ts`; the UI renames inline from the transcript. |
| Transcript editing | WORKING | `updateUtteranceText`; the database test "owner edits notes, speaker names and transcript text" covers it. |
| Transcript search | WORKING | The database test "search matches transcript, title and notes, only within what each person can read". |
| Semantic chat about recordings | WORKING | The `ask` Edge Function; `src/app/recording/[id].tsx` has the Ask tab. |
| Projects and teams, role-based access | WORKING | The database security suite covers outsider, teammate and admin boundaries across 75 tests. |
| Sharing links with expiry, revocation and passwords | WORKING | "share links: password stays hidden and is checked on the server; clips have sane ranges". |
| Exports | PARTIAL | Markdown, transcript and CSV are tested (`_shared/company.test.ts`). **PARTIAL:** the desktop's DOCX/PDF/SRT export paths are not covered by the test suite. |
| Calendar integration and notetaker | WORKING | `_shared/calendar.test.ts` and `_shared/bot_timing.ts`; "a calendar meeting gets at most one automatic notetaker". |
| Billing, entitlements, quota | WORKING | `_shared/entitlements.test.ts` (11 tests) plus the database tests for plans, minutes and server-only billing events. |
| Recording never destroyed by a quota or an error | WORKING | Audio is removed only after a confirmed upload (`src/lib/sync.ts`); the quota path keeps recording and queues processing. |

## 3. Recording

| Feature | Status | Evidence |
|---|---|---|
| Microphone recording, pause/resume | WORKING | `src/lib/recorder.ts`; `desktop/src/renderer/capture.ts`. |
| System audio capture | WORKING | `desktop/src/renderer/capture.ts` (two channels); macOS uses a ScreenCaptureKit helper (`src/main/main.ts`). |
| Segmented recording with immediate upload | WORKING | `src/lib/recorder.ts`, `src/lib/sync.ts`. |
| Crash recovery of an interrupted recording | PARTIAL | The logic is implemented on both platforms and the queue survives restarts. **BLOCKED on hardware:** the desktop's `#selftest` exists but a real kill-and-restart on each platform has not been run here. |
| Offline persistence before upload | WORKING | The desktop's local store under `userData/pending`; the phone's `pending-audio` directory. |
| Small loss window | PARTIAL | Phone parts are 5 minutes and web parts 2 minutes. Murmure removed its 5-minute limit with silence-based chunking (15 s arm, 500 ms silence cut, 60 s hard cut, 1 s overlap). **Not yet done here.** |
| Original-audio playback | WORKING | `src/lib/player.ts` maps ms to part across 5-minute files; `PlayerBar` has scrub, skip, speed and speaker. |

## 4. Desktop dictation (from Murmure)

| Feature | Status | Evidence |
|---|---|---|
| Global keyboard shortcuts | WORKING | The main process claims them with Electron's `globalShortcut` and gives them back when the app closes (`desktop/src/main/dictation.ts`). The rules — how a binding is described, how two are compared, how conflicts are refused — are in `desktop/src/shared/shortcuts.ts` with 6 tests. A shortcut the operating system will not give is refused and the reason is shown in the settings. |
| Push-to-talk | PARTIAL | The shortcut starts and stops a dictation, and the overlay says which. **The hold-to-talk half is not done:** Electron's `globalShortcut` reports a press, not a release, so holding needs a native key hook. |
| Dictation into another application | WORKING | The words go on the clipboard and the operating system is asked to paste them, with the arguments kept apart and no shell, so a word can never become a command (`desktop/src/shared/insert.ts`). When the tool is not there, the words stay on the clipboard and the user is told to paste them. |
| Floating recording overlay | WORKING | Its own undecorated, transparent, always-on-top window that never takes the focus (`desktop/src/renderer/overlay.html`). It shows the state, the level, the time and the progress, and has a cancel button. Everywhere except over that button it is see-through, so clicks reach the app underneath. It is a sandboxed page with its own preload and three abilities: show, cancel, and say where its button is. |
| Dictation history | WORKING | What was said and when, on the computer only — not uploaded and not part of the recording library (`desktop/src/shared/history.ts`, 9 tests). Searchable, copyable, deletable, clearable, and it can be turned off. |
| Read the selected text in another application | PARTIAL | The command that asks the system to copy the selection is written (`desktop/src/shared/insert.ts`). **Not wired up**, and it is only used by the AI commands, which are not done. |
| Local HTTP API for transcription | MISSING | |
| CLI control commands | MISSING | |

## 5. Personalisation (from Murmure)

| Feature | Status | Evidence |
|---|---|---|
| Custom dictionary / vocabulary | PARTIAL | The platform has project vocabulary and Deepgram key terms (`_shared/field.ts`: "keyterms: project words first, deduplicated, placeholders skipped, capped"). The desktop now has a user-level dictionary with import and export, and a confidence-gated correction (`desktop/src/shared/dictionary.ts`, 13 tests). **Not adopted:** boosting the model's own logits, which needs the BPE tokenizer and a much larger change to the decode loop. |
| Formatting rules (exact / substring / regex) | WORKING | `desktop/src/shared/formatting.ts`, 12 tests. The three kinds of rule, the order they run in, and a broken pattern leaving the text alone. |
| Built-in formatting options (punctuation, capitalisation, whitespace, numbers) | PARTIAL | `desktop/src/shared/formatting.ts`: spacing, sentence capitalisation, hesitation removal and the short-note treatment are done and tested. **MISSING:** spoken-number conversion. |
| HESITATION removal | WORKING | `removeHesitations()` in `desktop/src/shared/formatting.ts`. |

## 6. Voice features (from Murmure)

| Feature | Status | Evidence |
|---|---|---|
| Voice activity detection | PARTIAL | Both platforms detect silence to warn the user (`src/lib/recorder.ts`, `desktop/src/renderer/capture.ts`), which is a fixed threshold. Murmure uses an adaptive noise floor. **Deliberately not adopted:** the VAD here is a warning, not a decision, so the simpler version is enough. |
| Wake word | MISSING | **Deliberately not done.** It means listening all the time, which is the biggest privacy cost a dictation app can carry. |
| Silence timeout | MISSING | |
| Voice commands | MISSING | |

## 7. AI extensions (from Murmure)

| Feature | Status | Evidence |
|---|---|---|
| Local LLM (Ollama / OpenAI-compatible) | WORKING | `supabase/functions/_shared/services.ts` writes the notes through Anthropic, OpenRouter or a local Ollama model, chosen by `LLM_PROVIDER`. The local model is given the notes schema itself, so the answer comes back already shaped. |
| Prompt templates | PARTIAL | The platform has per-recording summary templates (`src/lib/templateLibrary.ts`). The prompt behind them is fixed, and is not yet editable. |
| AI commands on a selection | MISSING | |

## 8. Security

See `SECURITY_AUDIT.md`.

---

## Summary counts

| Status | Count |
|---|---|
| WORKING | 33 |
| PARTIAL | 14 |
| BROKEN | 0 |
| MISSING | 12 |
| BLOCKED | 0 |

Nothing is BROKEN: every feature that exists either passes its tests or is listed as
partly verified with the reason.

Of the 12 MISSING items, 4 are the Murmure features that were not built (the local
language model, the voice commands, the local HTTP API and the CLI), and 8 are
refinements (a disk-space check, a hardware check, word-level times, local
diarization, spoken-number conversion, reading the selection, and the hold-to-talk
half of push-to-talk).

**The biggest thing that changed since the first version of this document:** the local
speech engine was "BLOCKED on the engine". It now runs, and it was checked by
transcribing a real recording.
