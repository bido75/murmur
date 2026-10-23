# Security audit

A review of the local transcription work and the parts of the app it touches, with
the findings and what was done about them. This is an engineer's review, not a
penetration test.

## The most important thing

**Audio and transcripts do not leave the device unless the user asked.** Three
things enforce it, and they are checked by tests rather than by hope:

1. `chooseProvider()` puts local-only privacy ahead of every other setting.
2. `cloudAllowed()` is a second, independent check, so a caller that picks the
   cloud provider directly cannot slip past it.
3. `canRecordNow()` refuses a recording when the rules pick the device and the
   device cannot run — so the audio is not sent to the cloud in its place.

The desktop's local path never has a cloud fallback: `ParakeetProvider` refuses
rather than sending the audio to a speech service, and the main process refuses
with a plain message when the engine is missing.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | The desktop's renderer could read any file on the computer through the file bridge. | High | **Fixed** |
| 2 | The model archive was downloaded without being checked, so a tampered file could be installed. | High | **Fixed** |
| 3 | The user's words were pasted back with a shell command, so a word could become a command. | High | **Fixed** |
| 4 | The transcription engine was loaded with `require`, which does not exist in the module the app loads, so the engine silently never ran. | Medium | **Fixed** |
| 5 | The dictation history was not written anywhere, so it could be read by anything with the user's files. | Medium | **By design — see below** |
| 6 | The remote API key for a hosted language model would have been in the renderer. | High | **Not applicable — see below** |
| 7 | The words sent to the server are the transcript, so they are personal data. | Medium | **Known and stated** |

### 1. The renderer could read any file — fixed

The desktop's file bridge took a path from the renderer and read it:

```ts
ipcMain.handle("file:read", (_e, path: string) => new Uint8Array(readFileSync(safePath(path))));
```

`safePath()` checked the path was inside the app's own folder, which was the
right idea. But the audio folder holds the recording, and the renderer is a web
page: a script in it could ask for anything under that folder, including the
words of a recording that had not been sent yet.

**What was done.** The bridge was narrowed so that the renderer asks for a
recording by its id rather than by a path, and the main process works out the
path itself. The renderer no longer names a file at all.

The same narrowing applies to the text store that holds the words made from
each part: it is keyed by a name the main process builds, not by a path.

### 2. The model was not checked — fixed

The model is 650 MB of code that the app then runs. A tampered model would be a
tampered program.

**What was done.** The archive is checked against the SHA-256 published with the
model's own release, and **each file inside it** is checked separately, so a
damaged file is caught even when the archive as a whole looked right. A file is
only moved into place after it has been checked. The checksum is in the code and
pinned by a test.

The hash itself is `supabase/functions/_shared/sha256.ts`, our own plain
TypeScript. It is checked against the published test vectors, against the
platform's own crypto, and for the case where the bytes are fed in
different-sized pieces.

### 3. The paste went through a shell — fixed

Putting the words back where the user was typing needs a key press, and the
usual way is to run a command.

**What was done.** The commands are built as a program and its arguments, kept
apart, and run with `child_process.spawn` and no shell. A word from the
transcript can never become part of a command. The commands themselves are fixed
strings; nothing from the transcript is ever passed to one.

### 4. The engine silently never ran — fixed

The engine was loaded with `require()`, which does not exist in the module
system the app loads. The result was a caught error and a message saying the
engine was not installed — so the app looked correct and did nothing.

**What was done.** The runtime is loaded with a dynamic import, and the reason
for a failure is passed on rather than swallowed.

This one is worth calling out because it is the kind of bug that makes a
feature look finished when it is not: the code was there, the tests passed, and
the feature did not work. It was found by running the thing.

### 5. The dictation history stays in memory — by design

A dictation is often something private — a password, a name, a thought that is
nobody else's business. So the dictation history is kept in the app's memory and
is not written to disk unless the user asks for it to be. It is not uploaded.
It is not sent to the server.

### 6. There is no remote language model key — not applicable

A hosted language model would need an API key. That key must never be in the
renderer, because the renderer is a web page.

The app has no such feature. The one AI path is Anthropic Claude, called from
the server, where the key is a Supabase secret. When a local language model is
added, it must be the same shape: the endpoint is set by the user, the key is
never in the renderer, and the app says plainly in the settings whether the
words are going to a third party.

### 7. The words are personal data — known, and said

A local recording still sends its **words** to the server, so the notes can be
written. The audio stays on the device; the transcript does not. The settings
screen says so in those words, and the privacy note in `LICENSE_REVIEW.md`
says it too.

This is the single most important limitation of the local path, and it is not
hidden.

## What was checked in the existing app

| Area | How it was checked | Result |
|---|---|---|
| Row-level security | 75 database tests run as the signed-in user, a teammate, an outsider and the server | Every table isolates the people who should not see it. |
| Authentication | Every Edge Function resolves the caller from the session | No function trusts the body for who the caller is. |
| Authorisation | `readable_projects`, `can_read_recording` and the rest are server-side | The app cannot widen its own access. |
| Signed audio URLs | The audio bucket is private and the app gets a short-lived URL | A recording's audio is not a public URL. |
| Sharing links | Passwords are hashed and checked on the server; expiry and revocation are tested | A link can be withdrawn. |
| Secrets | Only `EXPO_PUBLIC_*` names are in the app's environment | The Anthropic, Deepgram and Stripe keys are server secrets. |
| Uploads | The audio is removed only after the upload and its row are saved | A failed upload keeps the recording. |
| Billing | The server counts the minutes and writes the plan | The app cannot give itself more. |

## The ONNX runtime

`onnxruntime-node` is a native module that runs the model. Two things were
checked about it:

- **It is MIT**, and it is a dependency of the desktop app only. It does not
  touch the mobile bundle.
- **It is loaded by name, lazily.** A computer without it still starts the app,
  and the user is told the engine is missing rather than the app failing to
  open.

The model itself comes from NVIDIA under CC BY 4.0 and is checked against a
published checksum.

## What is not covered

- **No penetration test.** This is a code review, not an attempt to break it.
- **Only Windows was exercised.** The desktop's path handling, the paste
  commands and the shortcuts were checked on Windows. The macOS and Linux paths
  are written but were not run — `docs/TEST_RESULTS.md` says which.
- **No dependency scan was run as part of this work.** `npm audit` should be run
  before shipping.
- **The wake word was not implemented**, so the microphone is never listened to
  without the user starting a recording. That removes the largest privacy
  surface a dictation app can have, and it is a decision, not an oversight.

## What to do before shipping

1. Run `npm audit` on both the app and the desktop, and deal with anything
   serious.
2. Have the "renderer cannot name a file" narrowing reviewed by someone who
   looks for path handling for a living.
3. Run the app on macOS and Linux and check the file permissions on the model
   folder and the recording folder.
4. Confirm with a lawyer that the model may be used this way (see
   `LICENSE_REVIEW.md`).
