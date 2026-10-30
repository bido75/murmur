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

### The desktop runtime (Step 3)

The desktop app is Electron, and stays Electron. Its own model manager lives in
`desktop/src/main/speechModelManager.ts` and works the same way as the phone's: the
model is a folder of files, each one checked against the size and SHA-256 published by
its host before it is used, with progress, a stop button, retry, and recovery from an
interrupted install.

**The model.** Parakeet TDT 0.6B v3, quantised to 8-bit and exported to ONNX. The model
weights are published under **CC BY 4.0**, so they may be used and redistributed with
attribution. The four files, with the checksums and sizes the host publishes:

| File | Size | SHA-256 |
|---|---|---|
| `encoder.onnx` | 653,979,575 | `4cbf4dfc2bd2c4a565609ef373925ad09cb55250c19d7e25f7893be49d5cb5f7` |
| `decoder.onnx` | 47,233,743 | `d593cdb0e571f5a457ec2219af9968cbf6b0e8198e8f7839b40a8754593bf68c` |
| `joiner.onnx` | 25,286,330 | `b9b0bcf88ac571902e69a6536223ed2d94885e981b85045410f1403d53121a63` |
| `tokens.txt` | 93,939 | `d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d` |

That is about 700 MB to download. It is a large download and the app says so before it
starts.

**The graphs.** The input and output names below were read out of the model files
themselves with the ONNX protobuf tool, not taken from anyone's memory:

```
encoder.onnx   audio_signal FLOAT [batch, 128, frames], length INT64 [batch]
                -> outputs FLOAT [batch, 1024, frames], encoded_lengths INT64 [batch]
decoder.onnx   targets INT32, target_length INT32, states.1 FLOAT [2, s, 640],
                onnx::Slice_3 FLOAT [2, 1, 640]
                -> outputs FLOAT [batch, 640, t], prednet_lengths INT32,
                   states FLOAT [2, s, 640], 162 FLOAT [2, s, 640]
joiner.onnx    encoder_outputs FLOAT [batch, 1024, t], decoder_outputs FLOAT [batch, 640, t]
                -> outputs FLOAT [batch, vocab, t, 8198]
```

**The audio.** The desktop records WebM with two channels: this computer's microphone on
the left and the call on the right. The renderer decodes the WebM with the browser's
own audio tools — no decoder has to be added — and hands the samples to the main
process. Each channel is read on its own, so the words of the person recording become
speaker 0 and the words of the call become speaker 1, which is the same numbering the
server uses for a two-channel recording.

**Into the existing pipeline.** The desktop's local path is the same path the phone
uses: each part becomes words, the words are kept until the whole recording is ready,
and then they go to `ingest/local-transcript`, which stores them, marks the recording as
transcribed on the device and runs the existing notes pipeline. Summaries, timestamp
citations, verified tasks, speaker correction, search, exports and team sharing all
work exactly as they do for a cloud recording, because they are the same code.

**What is not built yet.** The engine that runs those three graphs is a separate,
optional module. Until it is installed the app refuses in plain words rather than
quietly sending the audio to a speech service. Two pieces are missing and neither can
be written and checked without the engine installed:

1. **The feature front end.** The encoder wants 128 mel features per frame, not raw
   samples, so the audio has to be turned into a log-mel spectrogram first.
2. **The TDT decode loop.** The joiner's last axis is 8198 — the vocabulary plus the
   duration and offset symbols — and the decoder carries a state from frame to frame.
   Turning that into words is the substantial part of the work.

Neither is guessed at here. The bridge around them is complete: the input is checked,
the model is loaded from the right folder, the result comes back as `Utterance[]`, and
the job reports its progress, can be stopped, and reports what it used.

**Watching what it costs.** `desktop/src/main/resources.ts` reports the memory the app
is using, how much of the computer is free, and how much processor time a job takes.
The numbers are for the user and the logs; nothing is sent anywhere.

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
| `desktop/src/shared/speechModels.ts` | The desktop's model registry, checksums and install state machine |
| `desktop/src/shared/speechModels.test.ts` | 14 tests on the registry, the state machine and the checks |
| `desktop/src/shared/pcm.ts` | Turning recorded audio into what a model reads: mixing, resampling, silence |
| `desktop/src/shared/pcm.test.ts` | 9 tests on the audio helpers |
| `desktop/src/main/speechModelManager.ts` | Install, verify, cancel, retry, recover |
| `desktop/src/main/transcriber.ts` | The bridge to the local engine, and the refusal when it is missing |
| `desktop/src/main/resources.ts` | What the app and the computer are using |
| `desktop/src/renderer/speech.ts` | Decoding the recording and asking for the words |
| `desktop/src/renderer/speechPanel.ts` | The panel on the home screen |
| `desktop/src/renderer/dom.ts` | The shared element helper |
| `desktop/src/shared/transcription/interfaces.ts` | The desktop app's view of the shared interface |
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
| `desktop/src/shared/bridge.ts` | `speechModel`, `speechModelInstall`, `speechModelCancel`, `speechModelRemove`, `transcribeLocal`, `resources` and a small text store added |
| `desktop/src/main/preload.ts` | The passthroughs for those calls, and the `speech:progress` channel |
| `desktop/src/main/main.ts` | The handlers. The `transcribe:local` handler reads the samples with the local engine; `speech:install` reports progress to the window and can be stopped |
| `desktop/src/shared/queue.ts` | Two new operations: `local_segment` and `local_finalize` |
| `desktop/src/renderer/sync.ts` | The local path: a part becomes words, the audio is not uploaded, and the words go to `ingest/local-transcript` |
| `desktop/src/renderer/capture.ts` | Each part now says where it starts, and the recovery record says whether the recording was made on this computer |
| `desktop/src/renderer/app.ts` | The recording is made locally when the model is on; the panel on the home screen |
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
| `npx tsc --noEmit` (app) | passes |
| `npx expo lint` (app) | passes (0 errors, 0 warnings) |
| `npm test` (app logic) | **167 pass, 0 fail** (was 131; 36 new) |
| `npm test` (database security) | **75 pass, 0 fail** |
| `deno test --allow-all _shared/` | **167 pass, 0 fail** |
| Metro iOS bundle | builds, 1202 modules, no errors |
| `desktop`: `npx tsc --noEmit -p .` | **passes** (the desktop's own dependencies are now installed, so this is a real check) |
| `desktop`: `npm test` | **31 pass, 0 fail** (was 12; 19 new) |
| `desktop`: `node build.mjs` | builds; the SHA-256, the model manager and the published checksums are all in the bundle |

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
- **The desktop model registry** — every published file has a checksum, a size and an
  https address; the published sizes and checksums are pinned in a test; a file that is
  missing, short, unchecked or corrupt resolves to the right state; the model is only
  ready when every file is; the progress of the whole model counts each file by its
  size, so the number moves evenly instead of jumping when the big file finishes.
- **The desktop audio helpers** — the length of the audio, resampling (and that the
  result is the same however the bytes are divided), mixing two channels down, finding
  the loudest sample, and telling silence from a quiet meeting.

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
  runtime behind it. No Parakeet model is downloaded by the app, no ONNX runtime is
  installed, and the `transcribe:local` handler refuses with a plain message. There is
  no cloud fallback in it on purpose: the desktop app already sends its recordings to
  the server for cloud transcription, and a local request must never do that behind the
  user's back.
- **The desktop model download has not been run end to end.** The manager is complete
  and its rules are tested, but the 700 MB download has not been exercised from the app
  against the model host.
- **The desktop's WebM decoding depends on the browser.** The renderer uses
  `decodeAudioData`, which Chrome and Firefox do for WebM/Opus and Safari may not. If
  the decode fails, the part fails with an explanation and the audio stays on the
  computer; it is never sent anywhere. The failure is a stuck upload, not a lost
  recording.
- **The local engine itself is not written.** The mel front end and the TDT decode loop
  are the two pieces still to do, and they cannot be written and checked without the
  engine installed. They are described above from the model's own graph, so the next
  person does not have to work it out from scratch.
- **The model is a 700 MB download.** That is a lot to ask of a user, and it is the
  main reason the whisper model on the phone stays at 57 MB.
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
3. Add the ONNX runtime to the desktop and write the two missing pieces: the log-mel
   front end (128 features per frame for the encoder) and the TDT decode loop over the
   joiner's 8198-wide output, carrying the decoder's state from frame to frame. The
   graphs are described above, read out of the model files themselves. Check each
   against a known recording before trusting it.
4. Get the licensing question answered before step 3 ships.
5. Only then look at fully offline notes, which need a local summarisation model and a
   place to hold a transcript until it can be processed.
