# Local transcription — architecture, licensing and delivery notes

This is the design and the working prototype for adding a local, offline speech-to-text
path to Murmur. It is an addition to what already exists: the cloud path, the on-device
whisper path, the recording pipeline and the notes pipeline are all unchanged.

Prototype branch: `feature/transcription-local`

---

## 1. What already existed (the audit)

| Piece | Where | Reuse |
|---|---|---|
| Cloud transcription (Deepgram, speaker labels, key terms) | `supabase/functions/_shared/services.ts` | unchanged |
| On-device transcription (whisper.cpp via `whisper.rn`) | `src/lib/localStt.ts` | extended, not replaced |
| Segmented recorder, crash recovery, upload queue | `src/lib/recorder.ts`, `src/lib/sync.ts` | unchanged |
| Transcript schema and verified action items | `supabase/functions/_shared/verify.ts` | unchanged |
| Key-point times in the summary | `supabase/migrations/20261021140000_key_point_times.sql` | already present |
| Local-vs-cloud decision at record time | `src/app/record.tsx` | now driven by one shared rule |
| Speech model download | `src/lib/localStt.ts` | moved behind a manager with checks |

**Reusable and now used by the new code**

- `_shared/verify.ts` — the `Utterance` shape `{ start_ms, end_ms, speaker, text }` is
  already the normalised transcript format. It is the contract every provider must meet,
  so no new schema was invented.
- `_shared/ingest.ts` — `whisperToUtterances()` already turns whisper segments into that
  shape. The new Parakeet adapter produces the same shape.
- The summary pipeline already accepts a transcript plus speaker numbers, so a local
  transcript flows through summaries, timestamp citations, verified tasks, speaker
  renaming, search, chat, exports and team sharing with no change at all.

**What was missing**

- No way for the user to say "never upload audio", and no single rule that decides
  cloud-vs-local. The only switch was `onDevice`, which was off by default and could be
  set on without any privacy promise attached.
- The speech model was downloaded and trusted. A download that was cut short was caught by
  a loose size check (`> 40 MB`); a file that was the wrong content was not caught.
- No progress, no way to stop a download, no record of which build was installed, and
  nothing that cleaned up after an interrupted install.

---

## 2. Architecture

### The one rule, in one place

`supabase/functions/_shared/transcription_mode.ts` decides which engine runs. It is a pure
function, so the phone, the server and the desktop app all make the same decision and it
can be tested on its own.

```
chooseProvider({ mode, localReady, cloudReady, localOnly, preferLocal }) -> 'cloud' | 'local'
canRecordNow(ctx) -> boolean
```

The order matters and is deliberate:

1. **`localOnly` wins over everything.** If the user has asked for audio never to leave
   the device, nothing is uploaded — not in Auto mode, not because the cloud was faster,
   not because the model was missing.
2. An explicit `local` or `cloud` mode is honoured.
3. `auto` uses the device when it is ready and either the cloud is not available or the
   user prefers local; otherwise the cloud.

`cloudAllowed()` is a second, independent check on the same rule, so a caller that picks
the cloud provider directly cannot slip past the user's privacy choice.

`canRecordNow()` is the third. When the rules pick the device — because the user chose
"On this device", or because they asked for audio never to leave the machine — and the
device cannot run, **the recording is not made at all**. The audio is not sent to the
cloud in its place. (The cloud may be out of reach: the recording is still made and the
upload queued, which is the behaviour that already exists.)

### Where the rule is applied

- **Settings** (`src/app/privacy.tsx`) — the mode picker, the "Never upload audio"
  switch, and a plain statement of what leaves the device ("only the words are sent,
  never the audio" / "the audio is sent to the speech service").
- **Recording** (`src/app/record.tsx`) — the same rule decides whether the recording is
  made in WAV on the device (never uploaded) or normally (audio uploaded for cloud
  transcription).
- **The refusal path** — if the rules pick the device and it cannot run, the recording is
  refused with an explanation and a pointer to Settings. Uploading the audio would have
  broken the user's promise, and silently failing to transcribe would have been a worse
  surprise. The recording screen shows the same warning before the button is pressed.

### Model management (Step 3)

`src/lib/transcription/modelManager.ts` owns the model on the device:

- **Versioning** — the file name carries the model id and the build, so two builds can
  sit side by side and an old one is recognised as out of date rather than used.
- **Integrity** — the file is checked against the size and the SHA-256 published by the
  file's host. The check is remembered, so 60 MB is not re-hashed on every launch, but
  the file is re-checked before it is used for transcription.
- **Memory** — the model is read and hashed four megabytes at a time, so checking it
  needs about four megabytes of memory rather than two copies of the whole file. The
  hash is fed in pieces for the same reason.
- **Progress, cancel, retry** — `File.createDownloadTask()` (Expo SDK 57) reports
  progress and takes an `AbortSignal`, so the download can be stopped. A download that
  fails or is stopped deletes the partial file, so nothing half-finished can be mistaken
  for a working model.
- **Recovery after interruption** — a file of the wrong size is detected as damaged, the
  partial file is removed, and the user is told to download it again.

The checksum itself is computed by `supabase/functions/_shared/sha256.ts`, a plain
TypeScript SHA-256. React Native's engine has no `crypto.subtle`, and adding a native
crypto module for one hash was not worth a new dependency. It is verified against the
published test vectors, against the platform's own crypto, and for the case where the
bytes are fed in different-sized pieces — which is how the model is checked.

### The normalised transcript

There is no new schema. Every provider produces `Utterance[]`:

```ts
{ start_ms: number; end_ms: number; speaker: number; text: string }
```

- Deepgram already produced this.
- whisper already produced this via `whisperToUtterances()`.
- The Parakeet adapter produces this.

The interface itself lives in `supabase/functions/_shared/transcription_provider.ts`, so
there is one definition that the phone, the server and the desktop app all speak — not
one per app.

Nothing is fabricated. Where a provider cannot give a speaker label or a confidence
score, the field is absent rather than invented — `whisper.rn` gives no speaker labels
and no confidence, so a local transcript has neither, and the UI already says so.

---

## 3. Licensing and dependencies

### The reference project (Kieirra/murmure)

| Thing | Licence | Consequence |
|---|---|---|
| Murmure's own code | **AGPL-3.0** | **No code from it may be copied into this platform.** Nothing was copied. |
| Parakeet TDT 0.6B v3 model | **CC BY 4.0** | May be used freely, with attribution. |
| `parakeet-ultra` (Moondream fine-tune, int8 ONNX) | **CC BY 4.0** | Same. |

Murmure is a Tauri + Rust application. This platform is Expo/React Native plus Electron,
and the brief says Electron is not to be replaced by Tauri. So Murmure's shell is not
usable either.

**The way through:** the AGPL covers Murmure's *code*, not the *model*. The Parakeet
weights are CC BY 4.0, so the model can be used directly by implementing the inference
ourselves in the Electron app. That is the plan for the desktop adapter, and it is why
the adapter in this prototype is a boundary (`ParakeetProvider` calls an Electron IPC
channel) rather than a port of Murmure's engine.

**A lawyer should confirm this before the Parakeet work ships.** The reasoning above is
the standard reading of AGPL (which covers the licensed source, not the model weights),
but it is not a legal opinion, and "we did not copy the code" is not by itself a
compliance answer if a derivative relationship is later found.

### Dependencies added

**None.** No npm package was added to the app.

- The SHA-256 is in `_shared/sha256.ts` (our own code, no dependency).
- The model download uses `expo-file-system`, already a dependency.
- The model file itself is unchanged: the same `whisper.cpp` base model, already used,
  already downloaded from the same host.

### Dependencies the Parakeet work will need (not yet added)

| Dependency | Licence | Notes |
|---|---|---|
| `onnxruntime-node` | MIT | Runs the Parakeet ONNX graph. Desktop only, so it does not affect the mobile bundle. |
| Parakeet TDT 0.6B v3 / `parakeet-ultra` | CC BY 4.0 | Model weights. Attribution required in the app's acknowledgements. |
| NVIDIA NeMo (to convert the model) | Apache 2.0 | Build-time only; the shipped artefact is the ONNX file. |

`whisper.cpp` and `whisper.rn` are MIT and already in use.

---

## 4. File-level changes in this prototype

### New

| File | Purpose |
|---|---|
| `supabase/functions/_shared/sha256.ts` | SHA-256 in plain TypeScript, fed in pieces, for model checks on a phone |
| `supabase/functions/_shared/sha256.test.ts` | Published test vectors, a comparison against the platform's crypto, and the same hash however the bytes are divided |
| `supabase/functions/_shared/transcription_model.ts` | The model registry, checksums, install state machine |
| `supabase/functions/_shared/transcription_model.test.ts` | 13 tests: state machine, integrity, progress |
| `supabase/functions/_shared/transcription_mode.ts` | The cloud/local/auto rule, what leaves the device, and whether a recording may be made |
| `supabase/functions/_shared/transcription_mode.test.ts` | 14 tests, including that local-only always wins and that the device is never swapped for the cloud |
| `supabase/functions/_shared/transcription_provider.ts` | The one provider interface, shared by the phone, the server and the desktop app |
| `supabase/functions/_shared/transcription_provider.test.ts` | 4 tests on the digest check |
| `src/lib/transcription/modelManager.ts` | Install, verify, cancel, retry, recover |
| `src/lib/transcription/WhisperProvider.ts` | Whisper behind the shared interface |
| `desktop/src/shared/transcription/interfaces.ts` | The desktop app's view of the same interface |
| `desktop/src/shared/transcription/ParakeetProvider.ts` | Parakeet behind the interface, via the Electron bridge |
| `scripts/test-transcription.mjs` | A runnable check of the mode rules |

### Changed

| File | Change |
|---|---|
| `src/lib/localStt.ts` | Model download moved behind the manager; the file is checked before it is used. The public API (`localSttSupported`, `modelReady`, `downloadModel`, `deleteModel`, `transcribeLocal`) is unchanged, so callers were not touched. |
| `src/lib/localStt.web.ts` | Same API, still refuses on the web |
| `src/lib/api.ts` | `Settings` gains `transcriptionMode`, `localOnly`, `preferLocal`. `getSettings()` carries an old `onDevice: true` over to `mode: "local"`, so nobody's setting is lost. |
| `src/lib/shared.ts` | Re-exports the new shared modules |
| `src/app/privacy.tsx` | The mode picker, the "Never upload audio" switch, a plain statement of what leaves the device, and a model card with progress and a stop button |
| `src/app/record.tsx` | The recording is made locally when the rule says so; refused with an explanation when local-only is on and the model is missing |
| `desktop/src/shared/bridge.ts` | `transcribeLocal()` added to the bridge the renderer may use |
| `desktop/src/main/preload.ts` | The passthrough for that call |
| `desktop/src/main/main.ts` | The `transcribe:local` handler. It refuses, because the local speech runtime is a separate download that is not installed. |
| `tsconfig.json` | `allowImportingTsExtensions` so the shared modules can use Deno-style imports and still be type-checked |
| `.gitignore` | `*.log` |

### Also in this branch (not part of the transcription work)

- `src/app/recording/[id].tsx`, `src/components/SiteLog.tsx` — timestamp chips on
  decisions, task updates, site-log entries and transcript lines, completing
  `docs/ROADMAP.md` Milestone 1 item 2. The backend already supplied the times; only the
  display was missing.

---

## 5. Test results

All of these were run on this branch.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | passes |
| `npx expo lint` | passes (0 errors, 0 warnings) |
| `npm test` (logic) | **167 pass, 0 fail** (was 131; 36 new) |
| `npm test` (database security) | **75 pass, 0 fail** |
| `deno test --allow-all _shared/` | **167 pass, 0 fail** |
| Metro iOS bundle | builds, 1202 modules, no errors |
| `desktop`: `npx tsc --noEmit -p .` | no new errors; the desktop's own dependencies are not installed here, so `electron` types and the implicit-`any` errors they cause are pre-existing |

New tests, and what each one is actually protecting:

- **SHA-256** — the three published vectors, UTF-8 handling, the padding boundaries
  (55/56/64 bytes), and a 1000-byte buffer compared against the platform's own crypto.
  A mistake in the padding or the rounds cannot hide.
- **The hash is the same however the bytes are divided up** — eleven sizes, five chunk
  sizes, each compared against the platform's crypto. This is what makes it safe to hash
  a 60 MB model a piece at a time.
- **Model state** — a missing model, a short one, an unchecked one, an old build and a
  good one all resolve to the right state; a file of the right size but the wrong bytes
  is refused; the published checksum and size are pinned in a test so a typo in either
  cannot be taken as gospel.
- **Mode rules** — Auto prefers the cloud by default and the device when asked; local-only
  beats an explicit "Cloud" mode; `cloudAllowed()` is false whenever local-only is on;
  every branch of the "what leaves the device" text is covered.
- **Whether a recording may be made** — the cloud may be out of reach and the recording
  still happens; but when the device was chosen and cannot run, the recording does not
  happen and the audio is not sent to the cloud in its place.

### What was found and fixed by review

A review of this change found three real problems, all fixed and covered by tests:

1. **The model was re-hashed before every recording part.** `transcribeLocal()` called
   the verification each time, so a 60 MB file was read and hashed for every 5-minute
   part. The verification is now remembered, and the file is only re-checked when its
   size changes.
2. **Checking the model needed about 120 MB of memory.** The file was read whole and
   then copied into the hash's padding. It is now read and hashed four megabytes at a
   time.
3. **Choosing "On this device" without the model silently used the cloud.** The rule
   picked the device, the device could not run, and the audio was uploaded anyway —
   against what the user had asked for. The recording is now refused, and
   `canRecordNow()` in the shared module expresses the rule so it cannot drift again.

A fourth was fixed while reviewing: a model downloaded before versions were added was
no longer recognised, so existing users would have had to fetch 60 MB again. The old file
name is still accepted and checked.

### What is **not** covered, and why

These are honest gaps, not oversights:

- **On-device transcription has not been run on hardware.** The checksum, the size check
  and the state machine are tested; the actual whisper inference on a phone is not. The
  existing code was already marked "Untested on hardware" and still is.
- **No 30–60 minute recording has been transcribed locally.** The memory use of hashing
  was the obvious risk and has been addressed (the model is read in pieces), but the
  memory use of *loading* a 60 MB model into whisper on a phone is still untested.
- **The Parakeet adapter has never been run.** `ParakeetProvider` is a boundary with no
  runtime behind it. No Parakeet model is downloaded, no ONNX runtime is installed, and
  the `transcribe:local` handler in the Electron main process refuses with a plain
  message. There is no cloud fallback in it on purpose: the desktop app already sends
  its recordings to the server for cloud transcription, and a local request must never
  do that behind the user's back.
- **No local diarization and no offline summarisation.** Neither is implemented, and
  neither is claimed. A local transcript has no speaker labels and no confidence scores,
  and a local recording still needs the notes to be written by the cloud model — only
  the *audio* stays put.
- **No crash-recovery test for a model install.** The recovery path is implemented and
  its logic is unit-tested through the state machine, but the app has not been killed
  mid-download on a device.
- **CPU and memory use during transcription is not measured.**
- **The download can be stopped; a transcription in progress can also be stopped** (the
  whisper handle is told to stop), but neither has been exercised on a device.

---

## 6. Known limitations

1. **Local-only still sends the words.** The audio stays on the device, but the
   transcript is uploaded so the notes can be written. A recording made with local-only
   privacy still sends its text to the server and on to the language model. The UI says
   this in the words "only the words are sent", but it is the most important limitation
   in this whole change.
2. **Fully offline notes are not implemented.** The brief asks for a mode where nothing
   reaches a cloud model. That needs the transcript to be held locally until a permitted
   path exists, and a local summarisation model. Neither exists yet.
3. **No local speaker labels.** whisper gives none, so a local transcript has one
   undifferentiated speaker and the speaker-renaming feature has nothing to rename. The
   app's own copy has said this for some time; it is still true.
4. **Local transcription is slower and less accurate**, especially in noise.
5. **The cloud is assumed to be available.** `cloudReady` is `true` in the app because
   there is no connectivity probe yet, so in Auto mode the app picks the cloud when both
   work. If the device is offline, the recording is still made and the upload is queued —
   the behaviour that already exists.
6. **`onDevice` and `transcriptionMode` can disagree.** `onDevice` is kept for
   compatibility and the mode is what the app obeys. The settings screen writes both.
   This should be tidied once the migration has had time to land.
7. **Expo Go cannot run on-device transcription.** `whisper.rn` is a native module, so
   Expo Go reports "not available in this build". The mode picker says so. A development
   build is needed.

---

## 7. Deployment and rollback

### Nothing to deploy yet

This branch changes only the app. The Supabase Edge Functions, the database and the
migrations are untouched: no new tables, no new columns, no new functions, no new RLS.
`supabase/migrations/` is unchanged, so there is nothing to push to the database.

### To ship the app part

```bash
git checkout feature/transcription-local
npx tsc --noEmit && npx expo lint && npm test
npx eas build --profile development --platform ios    # a dev build: whisper.rn needs one
npx eas update --branch feature/transcription-local    # or an OTA update
```

`whisper.rn` is a native module, so the **first** release of this has to be a
development or production build, not an OTA update over an Expo Go build.

### Rollback

The change is contained and reversible in one step:

```bash
git checkout main
git branch -D feature/transcription-local
```

The new settings (`transcriptionMode`, `localOnly`, `preferLocal`) live in the app's own
`AsyncStorage` under `settings.v1`, not in the database, so an older build reading that
file simply ignores the extra keys. `getSettings()` spreads the saved settings over the
defaults, so an unknown key is harmless.

`modelManager.ts` writes the model to `document/models/<id>-<version>.bin`. The older
build looks for `document/models/ggml-base-q5_1.bin`. An older build will therefore not
find a model the new build downloaded, and will show "Download the speech model" — the
user downloads it once more, and nothing else breaks. If that is not wanted, rename the
file back to the old name.

The speech model itself is unchanged: the same `whisper.cpp` base model from the same
host. A rollback does not re-download 60 MB.

### Order of work from here

1. Run the local transcription on a real phone and measure memory and time for a
   30-minute recording.
2. Add a connectivity probe so `cloudReady` is honest, then Auto mode can pick the
   device when the network is down.
3. Build the Parakeet adapter behind the existing boundary: `onnxruntime-node` in the
   Electron main process, an IPC channel, and the Parakeet adapter using the CC BY 4.0
   model. Keep Electron.
4. Get the licensing question answered before step 3 ships.
5. Only then look at fully offline notes, which need a local summarisation model and a
   place to hold a transcript until it can be processed.
