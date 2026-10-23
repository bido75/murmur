# Test results

What was actually run, on what, and what it proved.

**Machine:** Windows 11, x64, Node 24.14.0, Deno 2.9.7, npm (Electron 44.7.2).

## What passed

| Suite | Command | Result |
|---|---|---|
| The app's logic | `npm test` (the `test:logic` half) | **167 pass, 0 fail** |
| The database's security | `npm test` (the `test:db` half) | **75 pass, 0 fail** |
| The server's logic | `deno test --allow-all _shared/` | **167 pass, 0 fail** |
| The desktop's logic | `desktop: npm test` | **83 pass, 0 fail, 2 skipped** |
| The app's types | `npx tsc --noEmit` | clean |
| The app's lint | `npx expo lint` | clean, 0 warnings |
| The desktop's types | `desktop: npx tsc --noEmit -p .` | clean |
| The desktop's build | `desktop: node build.mjs` | builds |
| The app's bundle | Metro, iOS | builds, 1202 modules |

The two skipped desktop tests are the ones that need the speech model; see below.

## The local engine, run for real

Two tests download the model, check it and read real speech. They are skipped when the
model is not there, and they are the reason the feature is not just written but working.

**The model download, check and unpack** — 582 MB over HTTP, checked against the
checksum published with the model's release, unpacked, and each file checked on its own:

```
✔ the model installs from the archive and every file is checked (34.6s)
```

**The engine reading speech:**

```
✔ the engine reads the speech and says what was said (38.4s)
```

The transcript it produced, from a WAV made with the voices already on the computer:

```
[0-3440]    The quick brown fox jumps over the lazy dog.
[3440-5120] The meeting starts at 9 o'clock.
```

Word-level times, sentences split at the full stop, and the times in order and inside
the audio.

**How long it takes**, measured on this machine:

| Step | Time |
|---|---|
| Download, check and unpack 582 MB | 34.6 s (about 17 MB/s) |
| Load the model into memory | 4.1 s |
| Read 5.9 s of speech | 2.5 s (about 2.4× faster than real time) |

**What that means for a meeting.** At 2.4× faster than real time, an hour of speech is
about 25 minutes of processing. The desktop transcribes each part as it finishes, in
the background, so the recording is never waiting on it — but the first notes appear a
while after the meeting ends. This is a real limit and it is stated in the settings.

### Running the engine tests yourself

```powershell
# The model, from its own release.
curl -L -o parakeet.zip https://github.com/Kieirra/murmure-model/releases/download/1.3.0/parakeet-tdt-0.6b-v3-int8.zip

# A spoken WAV, from the voices already on this computer.
powershell -File desktop/scripts/speak.ps1 -Text "The quick brown fox jumps over the lazy dog." -Out speech.wav

# The tests.
$env:MURMUR_TEST_MODEL_ZIP = "$PWD\parakeet.zip"
$env:MURMUR_TEST_SPEECH_WAV = "$PWD\speech.wav"
cd desktop; npm test
```

## What the tests cover, and what they do not

| Area | Covered by | Result |
|---|---|---|
| The cloud transcription path | `_shared/verify.test.ts`, `sharing.test.ts` | 167 logic tests pass |
| Who may read what | 75 database tests, each as the signed-in user, a teammate, an outsider and the server | Every table isolates the people who should not see it. |
| The local-only privacy rule | `_shared/transcription_mode.test.ts` | Local-only beats an explicit "Cloud" choice; the device is never swapped for the cloud. |
| The model download | `desktop/src/shared/speechModels.test.ts`, and the integration test | Size, checksum, progress, cancel, recovery. |
| The engine | `desktop/src/shared/parakeet.test.ts` and the integration test | The vocabulary, the words, the sentences, and a real recording. |
| The model archive | `desktop/src/shared/zip.test.ts` | The archive opens and the files come out byte-for-byte the same as a separate extraction. |
| The dictation rules | `desktop/src/shared/formatting.test.ts` | 12 tests. |
| The dictionary | `desktop/src/shared/dictionary.test.ts` | 13 tests. |
| The shortcuts | `desktop/src/shared/shortcuts.test.ts` | 6 tests. |
| The audio path | `desktop/src/shared/pcm.test.ts` | 9 tests. |

### Not covered

| Thing | Why | What to do |
|---|---|---|
| On-device transcription on a phone | No phone was connected | Run it on a device; the code path and the model check are done. |
| whisper running on a phone | `whisper.rn` is a native module and Expo Go does not have it | Needs a development build. |
| A 60-minute recording | It takes an hour and 25 minutes of processing | Run it before shipping; the parts and the queue already handle long recordings. |
| macOS and Linux | Only Windows was available | Run the desktop on both. The paste commands and the permissions differ. |
| The wake word, the overlay, the local language model | Not implemented | — |
| A crash in the middle of a model download | The recovery is written and unit-tested, but no device was killed mid-download | Kill the app mid-download and check it offers the model again. |
| The microphone being unplugged mid-recording | Needs the hardware | Unplug it. |

## The checks that run before anything is called done

```bash
npx tsc --noEmit
npx expo lint
npm test
cd supabase/functions && deno check */index.ts && deno test --allow-all _shared/
cd desktop && npx tsc --noEmit -p . && npm test && node build.mjs
```

## A note on what the numbers mean

The test counts are not the point; the point is that each one checks something real.
The ones worth knowing about:

- **The SHA-256** is checked against the published test vectors, against the platform's
  own crypto, and for the case where the bytes are fed in different-sized pieces —
  which is how the model is checked. A mistake in the padding or the rounds cannot
  hide.
- **The mode rules** are checked for the case that matters most: that "never upload
  audio" wins over an explicit "Cloud" choice, and that a recording is refused rather
  than uploaded when the device was chosen and cannot run.
- **The engine** is checked against a real recording, not against a mock.
