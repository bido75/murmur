# Architecture

How the app is put together, and where the local transcription sits in it.

## The shape of it

```
                    ┌─────────────────────────────┐
                    │  The app (Expo / React Native)│
                    │  phone · tablet · web        │
                    └──────────────┬──────────────┘
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
     ┌───────▼───────┐     ┌───────▼───────┐     ┌───────▼───────┐
     │  Record        │     │  Transcribe   │     │  Notes        │
     │  5-minute parts│     │  cloud or     │     │  summaries     │
     │  written to    │     │  on the       │     │  tasks with    │
     │  disk at once  │     │  device       │     │  quotes        │
     └───────┬───────┘     └───────┬───────┘     └───────▲───────┘
             │                     │                     │
             └──────────┬──────────┘                     │
                        │                                │
              ┌─────────▼──────────┐                     │
              │  The outbox          │                    │
              │  parts and words,    │                    │
              │  retried with backoff│                    │
              └─────────┬──────────┘                     │
                        │                                │
        ┌───────────────┼────────────────┐               │
        │                │                │               │
┌───────▼──────┐  ┌──────▼───────┐  ┌─────▼──────┐       │
│ Supabase     │  │ Supabase     │  │ The model  │       │
│ storage      │  │ functions    │  │ on the     │       │
│ (the audio)  │  │ (the notes)  │  │ device     │       │
└──────────────┘  └──────┬───────┘  └────────────┘       │
                          │                               │
                    ┌─────▼───────────────────────────────▼─────┐
                    │  Postgres: transcripts, summaries, tasks   │
                    │  every table has row-level security        │
                    └───────────────────────────────────────────┘
```

## The one rule that matters

Where the words are made is decided by **one pure function**, in
`supabase/functions/_shared/transcription_mode.ts`:

```
chooseProvider({ mode, localReady, cloudReady, localOnly, preferLocal })
  -> "cloud" | "local"
```

It is called from three places, and all three ask it the same question, so
they cannot disagree:

| Place | What it decides |
|---|---|
| `src/app/privacy.tsx` | Which engine the user has chosen, and what that means for their privacy. |
| `src/app/record.tsx` | Whether the recording is made on the device (WAV, never uploaded) or normally (audio uploaded, transcribed by the server). |
| `desktop/src/renderer/speech.ts` | Whether the desktop makes its own words. |

The order inside it is deliberate:

1. **Local-only privacy wins.** If the user asked for audio never to leave the
   device, nothing is uploaded — not in Auto mode, not because the cloud was
   faster, not because the model was missing.
2. An explicit `local` or `cloud` mode is honoured.
3. `auto` uses the device when it is ready and either the cloud is not available
   or the user prefers local.

And `canRecordNow()` says whether a recording may be made at all. When the
rules pick the device and the device cannot run, the recording is **not made**:
the audio is not sent to the cloud in its place, because that is the one thing
the user said not to do.

`cloudAllowed()` is a third, independent check on the same rule, so a caller
that picks the cloud provider directly cannot slip past the user's choice.

## The transcription interface

One interface, in `supabase/functions/_shared/transcription_provider.ts`, that
the phone, the server and the desktop app all speak:

```ts
type AudioSource =
  | { kind: "samples"; samples: Float32Array; sampleRate: number }
  | { kind: "file"; path: string }
  | { kind: "url"; url: string };

interface TranscriptionProvider {
  readonly type: "deepgram" | "whisper" | "parakeet";
  isAvailable(): Promise<boolean>;
  canTranscribe(options?): boolean;
  transcribe(source, options?): Promise<TranscriptionResult>;
}
```

The result is always the same shape:

```ts
type TranscriptionResult = {
  utterances: { start_ms, end_ms, speaker, text }[];
  durationMs: number;
  language: string | null;
  provider: "deepgram" | "whisper" | "parakeet";
  confidence?: number;   // only when the engine reports one
};
```

That shape is the `Utterance` type the rest of the app already used, so a
local transcript goes through exactly the same notes, citations, tasks,
search, exports and sharing as a cloud one.

**Nothing is invented.** A field the engine cannot supply is absent, not
guessed: `whisper.rn` reports no speaker labels and no confidence, so a
whisper transcript has neither, and the app says so.

### Who does what

| Engine | Where | Runs on | Audio leaves the device? |
|---|---|---|---|
| Deepgram | the server | the cloud | Yes — that is the point. |
| whisper (whisper.cpp) | the phone | the device | No. Only the words are sent. |
| Parakeet (ONNX) | the desktop | the device | No. Only the words are sent. |

## The local model

The desktop's engine is three ONNX graphs, run by `onnxruntime-node`:

```
audio ──► nemo128.onnx ──► 128 features a frame
                              │
                              ▼
                    encoder-model.int8.onnx ──► 1024 numbers a frame
                              │
                              ▼
                    decoder_joint-model.int8.onnx ──► the next token
                                                        and how many
                                                        frames to wait
```

The decoding is greedy. At each frame the likeliest token is taken, and the
model says how many frames to wait before looking again. A frame is 80 ms, so
that is how far apart two words can be.

The model comes as a zip. The archive is read from the file rather than loaded
into memory, because it is 580 MB and the model inside it is 650 MB. Each file
is inflated a piece at a time, written to disk, and checked against the
checksum published with it before it is moved into place.

## Where things live

| Place | What is there |
|---|---|
| `src/` | The Expo app: phone, tablet and web. |
| `desktop/src/main/` | The Electron main process: windows, files, the model, the engine. |
| `desktop/src/renderer/` | The desktop window. |
| `desktop/src/shared/` | The desktop's pure logic, where the tests live. |
| `supabase/functions/_shared/` | The logic the app and the server both use. |
| `supabase/functions/` | The Edge Functions: only the doing, no decisions. |
| `supabase/migrations/` | The database. Every table has row-level security. |

## The rules the code follows

1. **Decisions are pure and shared.** Anything both the app and the server have
   to agree on lives in `supabase/functions/_shared/` and is tested on its own.
2. **The Edge Functions only do the doing.** They read, write and call out.
3. **The database decides who may see what.** Row-level security, tested with
   the users who should and should not be able to read.
4. **Audio is never thrown away by a failure.** It is removed only after the
   upload is confirmed.
5. **Nothing private reaches the network unless the user asked.** The local
   path sends the words and never the audio.

## The platform differences

| Platform | How it records | How it transcribes |
|---|---|---|
| Windows, macOS, Linux (desktop) | Two channels: this computer's microphone and the call. | The model on the computer, or the cloud. |
| iOS | 16 kHz WAV, so whisper can read it straight away. | whisper on the phone, or the cloud. |
| Android | PCM written to a WAV. | whisper on the phone, or the cloud. |
| Web | The browser's own recorder, in 2-minute parts. | The cloud. The browser cannot hold a 650 MB model. |

These are not claims about parity. Each one was checked on that platform, and
`docs/FEATURE_AUDIT.md` says which were checked and which were not.
