# Murmure integration

What was taken from the Murmure project, what was written from scratch, and why.

**Reference:** [Kieirra/murmure](https://github.com/Kieirra/murmure) at commit
`2218c1bab463d17ace34258a3842b9f230d60ca3` (v2.0.3), **AGPL-3.0-or-later**.

**No Murmure source code is in this repository.** Not the Rust, not the TypeScript,
not a function body, not a constant table, not a comment. What was taken was *facts
about a model* and *descriptions of behaviour*, and everything that was written was
written here. `LICENSE_REVIEW.md` has the reasoning and the questions for a lawyer.

## The feature-by-feature inventory

| Murmure feature | Murmur equivalent | What was done | Status |
|---|---|---|---|
| Parakeet local speech-to-text | Cloud (Deepgram) and on-device whisper | **Written from scratch** against the model's own ONNX graphs: the mel front end, the encoder, the greedy TDT decode loop. The model artefacts are used under CC BY 4.0. | **Done, and verified against real speech.** |
| The model is bundled with the app | Models are downloaded on demand | Kept our way: downloaded, checksum-verified, versioned, with progress, a stop button and recovery. | **Done.** |
| Mel front end as an ONNX graph | — | Used the same approach: `nemo128.onnx` does the spectrogram, so there is no hand-written DSP to get wrong. | **Done.** |
| Greedy TDT decode, 80 ms a frame | — | Written from the published algorithm. A frame is 10 ms of hop, 8 times subsampled. | **Done.** |
| Per-token confidence | Cloud gives confidence; whisper does not | The confidence comes from the raw logits. Where an engine cannot give one, the field is absent, not invented. | **Done.** |
| The 5-minute recording limit | The desktop records 5-minute parts | **Not needed**: the limit was removed upstream by silence-based chunking. Our parts are already short, and the local path transcribes each part. | **Kept our way.** |
| Silence-based chunking | The desktop's 5-minute parts | Not adopted: our parts are already short enough, and the desktop reads each part as it finishes. | **Deliberately not adopted.** |
| Adaptive noise-floor VAD | A fixed silence threshold warns the user | The VAD is a warning, not a decision, so the simple version is enough. | **Kept our way.** |
| Dictionary, boosted into the model | Project vocabulary, sent to Deepgram as key terms | **Written from scratch** as a confidence-gated correction: a word the model was sure about is left alone. | **Done.** |
| Formatting rules (exact / substring / regex) | None | **Written from scratch**, with the pattern checked before it is used and a broken one leaving the text alone. | **Done.** |
| Short-text correction, hesitations, spacing, capitalisation | None | **Written from scratch**, and careful with acronyms and with words that have a capital of their own. | **Done.** |
| Global shortcuts | None | **Written from scratch**: the bindings, the conflicts and the accelerator Electron wants. The main process claims them and gives them back when the app closes. | **Done.** |
| Push-to-talk | The desktop records with a button | The shortcut starts and stops a dictation. **The hold half needs a native key hook**, because Electron's global shortcut reports a press, not a release. | **Partly done.** |
| Floating overlay | None | **Written from scratch**: its own transparent, always-on-top window that never takes the focus, see-through except over its cancel button. | **Done.** |
| Dictation into another application | The share sheet copies to the clipboard | The paste commands for each system, with the arguments kept apart so a word can never become a command, and a clipboard fallback. | **Done.** |
| Dictation history | The recording library | **Written from scratch**, on the computer only: not uploaded and not part of the library. | **Done.** |
| Local language model (Ollama) | Anthropic Claude, on the server | **Not done.** | **Not done.** |
| Prompt templates and AI commands | Summary templates, on the server | **Not done.** | **Not done.** |
| Wake word | None | **Not done, and deliberately so.** A wake word means listening all the time; that is the biggest privacy cost a dictation app can carry, and it is not worth it without the user asking for it. | **Deliberately not done.** |
| Voice activity detection | Silence warning | Kept our way. | **Kept our way.** |
| Local HTTP API | The Supabase API | **Not done.** | **Not done.** |
| CLI control commands | None | **Not done.** | **Not done.** |
| System volume ducking while recording | None | **Not done.** | **Not done.** |
| Per-OS file permissions (`0700` folders, `0600` files) | The phone's app folder | The desktop's folder is the system's own; **the model folder's permissions are not yet tightened**. | **Partly done.** |

## The two things worth explaining

### The model is used; the code is not

Murmure's own Rust engine is AGPL-3.0. Its **model** is not: the Parakeet weights are
published by NVIDIA under **CC BY 4.0**, and the mel graph is a model artefact of the
same lineage.

So the model is used directly and the code is written here. The graphs' names, shapes
and tensor layouts were read out of the model files with the ONNX protobuf tool:

```
nemo128.onnx              waveforms FLOAT [batch, N], waveforms_lens INT64 [batch]
                           -> features FLOAT [batch, 128, T], features_lens INT64 [batch]
encoder-model.int8.onnx   audio_signal FLOAT [batch, 128, T], length INT64 [batch]
                           -> outputs FLOAT [batch, 1024, T], encoded_lengths INT64
decoder_joint-model.int8.onnx
                           encoder_outputs FLOAT [batch, 1024, T], targets INT32,
                           target_length INT32, input_states_1/2 FLOAT [2, B, 640]
                           -> outputs FLOAT [batch, T, 1, 8198], prednet_lengths INT32,
                              output_states_1/2, lse_token, lse_duration,
                              topk_logits, topk_ids, duration_logits FLOAT [.., 5]
```

The joint's last axis is 8198: 8193 vocabulary entries plus 5 duration classes.

### The verify is a run, not a reading

The engine was checked by running it on a WAV made from the voices already on the
computer. It came back:

```
[0-3440]    The quick brown fox jumps over the lazy dog.
[3440-5120] The meeting starts at 9 o'clock.
```

with word-level times, and the integration test checks that the words came through, that
the times are in order and that they are inside the audio.

Along the way, four real bugs were found and fixed — a hash that was re-run for every
recording part, a check that needed 120 MB of memory, a choice of "on this device"
that silently fell back to the cloud, and a model download that was not recognised after
an update. None of them would have been found by reading the code.

## What is left, and what it would take

| Work | What it needs |
|---|---|
| The hold half of push-to-talk | A native key hook, so the key's release can be seen. Electron's global shortcut only reports a press. |
| The local language model | An Ollama-compatible client, and a decision about where the key lives. |
| The wake word | A keyword-spotting model, and a clear decision about always listening. |
| A local diarization | A speaker model, or an honest note that the two channels are the best we can do. |
| Word-level timestamps | The engine would have to give them; Parakeet does not. |
| The AI commands | The selection-reading is written; the rest needs the language model. |
| macOS and Linux checks | The code is written for them; only Windows was run. |
