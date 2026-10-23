# The speech model on the desktop

The desktop app can make its own words, on the computer, with no internet. This is how
to get the model, what it costs, and what it does.

## What it is

**Parakeet TDT 0.6B v3**, quantised to 8-bit.

- The model is **NVIDIA's**, published under **CC BY 4.0**. It may be used and
  redistributed with attribution.
- The int8 ONNX export is by a third party, also under CC BY 4.0.
- **No source code from the project this was modelled on is used.** That project is
  AGPL-3.0, and none of its code is in this repository. See `LICENSE_REVIEW.md`.

It is an English model. It is not asked what language it heard, so the app does not
claim one.

## Getting it

The desktop app downloads it. Settings → Privacy & data → "Download the speech model".

| | |
|---|---|
| Download | 582 MB |
| Unpacked | about 668 MB |
| Where it goes | `userData/speech-models/parakeet-tdt-0.6b-v3-int8-1.3.0/` |
| Time on a good connection | about 35 seconds, including checking |
| Time to use it | about 4 seconds to load into memory |

The download can be stopped. If it is interrupted, the partial file is removed and the
next attempt starts clean.

## It is checked, not trusted

The archive is checked against the SHA-256 published with the model's release:

```
6c2f64b17827d7051c9b6fe08dd422103b2cc05381a4d9cd7e4041e7fa6373ba
```

and **each file inside it** is checked on its own:

| File | Size | SHA-256 |
|---|---|---|
| `nemo128.onnx` | 139,764 | `a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f` |
| `encoder-model.int8.onnx` | 649,524,002 | `fc7de298eae88ba8aae8ea62bde60cd401401bd294748b8d57a72e5ad6b9d04a` |
| `decoder_joint-model.int8.onnx` | 18,203,490 | `f7e2db395a3b738cb2893cfb853d25863cebcc5282583a2e86b5762559e0bd32` |
| `vocab.txt` | 93,939 | `d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d` |

A file is only moved into place after it has been checked. A damaged download is
refused, not used.

## Downloading it by hand

```powershell
curl -L -o parakeet.zip https://github.com/Kieirra/murmure-model/releases/download/1.3.0/parakeet-tdt-0.6b-v3-int8.zip
```

The app will not use a file put there by hand — it checks what it downloaded itself.
But the archive is what the tests use:

```powershell
$env:MURMUR_TEST_MODEL_ZIP = "$PWD\parakeet.zip"
```

## What it needs

- **ONNX Runtime 1.30.0 or newer.** The app brings it (`onnxruntime-node`). An older
  version cannot read the 8-bit weights: it says "Only 4b quantization is supported".
- **About 700 MB of disk** for the model, plus the recordings.
- **A processor.** It runs on the processor; there is no graphics-card path. It is
  about 2.4× faster than real time on the machine it was measured on, so an hour of
  speech takes about 25 minutes.

## What it does, and what it does not

| | |
|---|---|
| **Does** | Read the words, with the times they were said, in English, on this computer, with no internet. |
| **Does** | Work on a long recording, a part at a time. |
| **Does not** | Tell speakers apart. The desktop's two channels give "you" and "them"; it cannot tell two people on the call apart. |
| **Does not** | Give word-level times. The times are to the sentence. |
| **Does not** | Write the notes. The words go to the server, and the cloud model writes the notes from them. **The audio stays on the computer; the words do not.** |
| **Does not** | Speak any language but English. |

The last one is the most important: **a local recording is not a fully offline
recording.** The audio never leaves the machine, but the transcript does, so the notes
can be written. The settings screen says so in those words.

## Removing it

Settings → Privacy & data → "Remove the speech model". The folder is deleted.

## Attribution

The app must credit NVIDIA for Parakeet under CC BY 4.0. **This has not been added to
the app yet** — it is on the list in `PRODUCTION_READINESS.md`, and it must be done
before the app is released.

The wording should say something like:

> Transcription on this computer uses Parakeet TDT 0.6B v3 from NVIDIA, licensed under
> CC BY 4.0, and the int8 ONNX export by @thiswillbeyourgithub.
