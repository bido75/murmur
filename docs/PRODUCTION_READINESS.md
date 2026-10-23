# Production readiness

Where this stands, what is left, and what must not be claimed.

**Branch:** `feature/transcription-local`
**Reference:** [Kieirra/murmure](https://github.com/Kieirra/murmure) at
`2218c1bab463d17ace34258a3842b9f230d60ca3` (AGPL-3.0-or-later)

## What is done and proved

| | Evidence |
|---|---|
| The local speech engine runs and reads real speech | The integration test downloads the model, checks it and transcribes a WAV: "The quick brown fox jumps over the lazy dog. The meeting starts at 9 o'clock." |
| The model is checked, not trusted | The archive and each file in it are checked against published SHA-256 values; a test proves the archive unpacks byte-for-byte. |
| Local-only privacy is kept | 14 tests in `_shared/transcription_mode.test.ts`, including that "never upload audio" beats an explicit "Cloud" choice. |
| A recording is never lost | The audio is removed only after the upload and its row are saved. |
| The whole app still works | 167 logic tests and 75 database security tests pass; both typechecks are clean; the desktop builds. |
| The renderer cannot name a file | The bridge was narrowed so the window asks for a recording, not a path. |

## What must be done before release

### Must

1. **Add the attribution.** The model is CC BY 4.0 and the app must credit NVIDIA.
   Not done. See `MODEL_SETUP.md` for the wording.
2. **Get the licensing question answered.** A lawyer must confirm that the written
   implementation, which reads the same permissively-licensed model, is not a
   derivative work of the AGPL project. See `LICENSE_REVIEW.md`.
3. **Run the app on macOS and Linux.** Only Windows was run. The paste commands, the
   file permissions and the model folder's permissions are all different.
4. **Run the phone build.** The whisper path has never run on a phone.
5. **Run a 60-minute recording end to end.** The parts and the queue handle long
   recordings; a real one has not been through.
6. **Tighten the model folder's permissions.** The recording folder is the system's
   own; the model folder's permissions are not yet set.
7. **Run `npm audit`** on the app and the desktop.

### Should

8. Wire the dictation shortcuts, overlay, paste and history into the window. The rules
   are written and tested; the Electron wiring is not done.
9. Add a note of how long the processing takes, so a user is not surprised by it.
10. Make the model folder's size visible next to the download button.

### Deliberately not done

11. **The wake word.** It means listening all the time, which is the biggest privacy
    cost a dictation app can carry. It should not be added without the user asking for
    it, and the mic must never be listened to without a recording being started.
12. **The local language model.** There is one AI path — Anthropic Claude, on the
    server — and the key is a server secret. Adding a hosted model means the key would
    have to be somewhere else, and that needs thinking about first.

## What must not be claimed

These are the claims this work does **not** support, and the app must not make them:

| Do not say | Why |
|---|---|
| "Fully offline" | The **audio** stays on the device; the **words** go to the server so the notes can be written. |
| "Nothing leaves your device" | The transcript leaves. The audio does not. |
| "Speaker names" | The local model cannot tell speakers apart. The two channels give "you" and "them", and nothing more. |
| "Word-level timestamps" | The times are to the sentence. |
| "Every language" | The local model is English. |
| "Runs on your phone" | The phone path is written and the model is checked, but it has not been run on a phone. |
| "Instant" | An hour of speech takes about 25 minutes of processing on the machine it was measured on. |

## The risk that matters most

**The licensing.** Everything else here is engineering, and engineering problems have
answers. If the written implementation turns out to be a derivative work of the AGPL
project, the desktop app's local transcription has to come out.

The work done to keep that risk low:

- No Murmure source was copied, linked or shipped.
- The model artefacts are CC BY 4.0 and are used under their own licence.
- The algorithm was taken from the published architecture and from the model's own
  graphs.
- Every place where Murmure's behaviour was used as a specification is written down in
  `MURMURE_INTEGRATION.md`, so the reasoning can be reviewed.

**A lawyer still has to say yes.** That is the one thing an engineer cannot do.

## The risk that comes second

**The model is 650 MB and takes a quarter of an hour to read an hour of speech.** That
may be too slow, and too big, for people to want. It is not a defect — it is what the
model is — but it should be measured on a few ordinary computers before the app is
sold on the strength of it.

## The feature inventory

`docs/FEATURE_AUDIT.md` has every feature with its status and the evidence behind it.
`docs/MURMURE_INTEGRATION.md` has the Murmure comparison, feature by feature.

## The checks

```bash
npx tsc --noEmit
npx expo lint
npm test
cd supabase/functions && deno check */index.ts && deno test --allow-all _shared/
cd desktop && npx tsc --noEmit -p . && npm test && node build.mjs
```

All of these pass on this branch. `docs/TEST_RESULTS.md` has the numbers and what is
not covered.
