# Who reads the audio

The words of a recording are read by a speech engine. **Two** can do it, and which
one is used is decided by `STT_PROVIDER`. Both are on the server; neither is the
on-device engine (that is Whisper on the phone and Parakeet on the desktop).

| Provider | Model | What it does |
|---|---|---|
| `deepgram` | `nova-3` (default) | Speech to text with speaker labels, key terms and redaction. |
| `mistral` | `voxtral-mini-transcribe-3` (default) | Voxtral: speech to text with speaker labels, timestamps and a vocabulary bias. |

## Choosing one

```
STT_PROVIDER=deepgram   # or mistral
```

`mistral` also needs:

```
MISTRAL_API_KEY=...
MISTRAL_STT_MODEL=voxtral-mini-transcribe-3   # or voxtral-small-transcribe-3
```

Without `STT_PROVIDER`, Deepgram is used.

## Fallback

**Both engines are tried, so one failing does not fail the recording.** The
configured engine goes first and the other is the fallback. A transient network
blip (a "Temporary failure in name resolution", say) is retried three times with a
short wait before moving on, so a one-second wobble does not fail a recording that
took an hour to make.

The one exception is redaction: only Deepgram can keep that promise, so when a
redaction is asked for, Deepgram is the only engine that may run. A privacy setting
is never dropped silently.

If an engine's key is not set, it is skipped rather than tried and failed.

## The one rule that matters

**A redaction is a promise, and Mistral cannot keep it.**

When the user or the workspace asks for personal details to be taken out of the
transcript (`redact` in `user_settings`), the request goes to Deepgram even when
`STT_PROVIDER=mistral`, because Deepgram is the engine that redacts. A privacy
setting is never dropped silently.

## How each engine gets the audio

Deepgram is given a link to the audio, and only sends the audio itself when the
service cannot reach the link (a local setup). Mistral cannot fetch a link, so it
is always given the audio itself.

## How the answer is shaped

Both engines return the same shape to the rest of the app: an utterance is a piece
of text with its time in milliseconds and a speaker number.

| Deepgram gives | Mistral gives | The app keeps |
|---|---|---|
| `start`, `end` (seconds) | `start`, `end` (seconds) | milliseconds |
| `speaker` | `speaker_id` (`"speaker_1"`) | a number from 0 |
| `transcript` | `text` | `text` |

The mapping and the rule live in `supabase/functions/_shared/mistral.ts`, and are
tested in `mistral.test.ts`.

## Key terms

The project's own vocabulary is sent to each engine in its own way: Deepgram takes
`keyterm`, Mistral takes `context_bias` (one form field per term). Both are the
same idea — the words the recording is expected to contain, spelled the way the
project spells them.

## Trying it

The whole pipeline can be run against a local stack, from a new account through the
audio, the transcription and the notes:

```powershell
node scripts\test-local-pipeline.cjs
```

The transcript shows which engine read it: Deepgram writes the time of day as
`09:00`, Mistral as `9 o'clock`.

After changing the settings, rebuild the Edge Runtime:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restart-local-functions.ps1
```
