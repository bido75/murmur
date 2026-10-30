# Licence and dependency review

**Reference project:** [Kieirra/murmure](https://github.com/Kieirra/murmure) at commit
`2218c1bab463d17ace34258a3842b9f230d60ca3` (v2.0.3), `LICENSE` = **AGPL-3.0-or-later**.

**This review is a technical assessment by an engineer, not a legal opinion.** It
identifies obligations and risks so a lawyer can make the call quickly. Nothing that
needs legal sign-off has been merged into the application.

---

## 1. The short version

| Artefact | Licence | Can we use it? |
|---|---|---|
| Murmure's own source (Rust, TypeScript, configs) | **AGPL-3.0-or-later** | **No**, not in this proprietary codebase, until a lawyer clears it. |
| Parakeet TDT 0.6B v3 model weights | **CC BY 4.0** | **Yes**, with attribution. |
| The mel front-end graph `nemo128.onnx` | Model artefact (CC BY 4.0 / Apache-2.0 lineage) | **Yes**, as a model artefact. |
| `vocab.txt` | Model artefact, CC BY 4.0 | **Yes**, with attribution. |
| `tokenizer.json` (the BPE used for phrase boosting) | Model artefact, CC BY 4.0 | **Yes**, with attribution. |
| NVIDIA NeMo (the framework the model was built with) | Apache-2.0 | Yes. |
| ONNX Runtime (`onnxruntime-node`) | MIT | Yes. |
| `whisper.cpp` / `whisper.rn` (already in use) | MIT | Yes. |

**The way through:** AGPL covers Murmure's *source code*, not the *model*. The Parakeet
weights and the mel graph are published under permissive licences and can be used
directly. The **algorithm** — how the audio becomes a mel spectrogram, how the encoder
feeds the decoder, how the TDT loop turns logits into words — is not itself
copyrightable: it is the published Parakeet/NeMo architecture, described in NVIDIA's
Apache-2.0 documentation and papers. So the plan is:

> Use the permissive model artefacts directly, and write our own implementation of the
> published algorithm.

That is what has been done so far, and it is what the rest of the work will do.

## 2. What was NOT done

**No Murmure source code was copied into this repository.** Not the Rust, not the
TypeScript, not the configuration. Not a function body, not a constant table, not a
comment. The only things taken from Murmure were:

1. **Facts about the model** — the file names, the ONNX input and output names, the
   tensor shapes, the mel parameters, the vocabulary format and the duration semantics.
   These are facts about a model published under CC BY 4.0 and an architecture published
   under Apache-2.0. They were read out of the model files themselves (with the ONNX
   protobuf tool) rather than copied from Murmure's source.
2. **Behavioural descriptions** — how the app behaves, used as a specification for an
   independent implementation.

## 3. The AGPL obligations, spelled out

AGPL-3.0 is the strongest of the common copyleft licences for a networked application.
The obligations that matter here:

| Obligation | What it means for us |
|---|---|
| **§5 — convey the source** | Anyone who receives the covered program must get its source. |
| **§13 — remote network use** | "If you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network an opportunity to receive the Corresponding Source of your version." This is the clause the FSF added in AGPL specifically to cover network services. |
| **§6 — conveying derived works** | A derivative work must itself be AGPL, and must carry the notices. |
| **§4 — automatic licensing** | Downstream users get the AGPL licence for anything we distribute. |
| **§15/§16 — the "mere aggregation" rule** | Combining our code with Murmure's in one program makes the combination covered. |

### The key legal question, and why the answer is "do not copy"

AGPL §10 has an explicit exemption for "mere aggregation" in a shared library, where
each party remains the owner of its own code. **But the exemption is narrow, and it
does not cover what we would actually be doing.**

Murmure is a **Rust library crate plus a Tauri application**. If we copied its
`engine/` module into our Electron app's main process, we would not be aggregating
with a separate program — we would be *including* the code, and the whole combined
program would be a derivative work under AGPL §13, meaning our proprietary desktop
app would have to be released as AGPL source to every user who receives it.

**A separate process is not a loophole.** Murmure does not do it this way, but it is a
common misunderstanding worth stating: invoking AGPL software as a subprocess does not
automatically avoid the obligation. The FSF's position is that the question is whether
the work is a derivative work; where the "mere aggregation" line falls depends on
whether the programs communicate at arm's length over a shared interface or are
combined into one program. Even where it does fall on the aggregation side, the
distribution of the AGPL binary still carries the AGPL obligations for *that* binary,
and the analysis is fact-specific.

**Therefore: no Murmure source, no linking against it, no shipping it, no running it
as a helper.** This is the position this project has taken, and it is why the local
engine is being written from scratch against the published algorithm and the
permissively-licensed model.

### What is still needed from a lawyer

1. **Confirmation** that the written-from-scratch implementation, which reads the same
   CC BY 4.0 model artefacts, is not a derivative work of Murmure's Rust code. We
   believe it is not, because it shares no expression with it — only the model and the
   published architecture. A lawyer should confirm this, because it is the single
   assumption the whole approach rests on.
2. **Confirmation** of the attribution wording required by CC BY 4.0 for the Parakeet
   weights and the mel graph.
3. **Confirmation** that no third-party code has leaked into this repository. The
   automated check in `scripts/` should be run over the history, not just the tree.

## 4. The model artefacts, and their obligations

The model release used is
[`Kieirra/murmure-model` 1.3.0](https://github.com/Kieirra/murmure-model/releases/tag/1.3.0),
`parakeet-tdt-0.6b-v3-int8.zip`. It contains:

| File | What it is | Licence |
|---|---|---|
| `nemo128.onnx` | The mel front end: pre-emphasis, framing, STFT, mel filterbank, log, normalisation. | Model artefact — CC BY 4.0 lineage |
| `encoder-model.int8.onnx` | The FastConformer-style acoustic encoder, 8-bit. | Model artefact — CC BY 4.0 |
| `decoder_joint-model.int8.onnx` | The prediction network and the joint, 8-bit. | Model artefact — CC BY 4.0 |
| `vocab.txt` | The token vocabulary, `"<token> <id>"` per line. | Model artefact — CC BY 4.0 |
| `tokenizer.json` | A Metaspace BPE, used only for dictionary phrase boosting. | Model artefact — CC BY 4.0 |

The upstream model is **NVIDIA's `parakeet-tdt-0.6b-v3`**, published by NVIDIA under
CC BY 4.0.

### CC BY 4.0 obligations

- **Attribution.** The app must credit NVIDIA for Parakeet and name the licence. This
  must appear in the app's acknowledgements, the model's own download card, and the
  documentation. Not yet done — tracked in `PRODUCTION_READINESS.md`.
- **Indicate changes.** If we modify the artefacts (we do not) we must say so.
- **No additional restrictions.** We may not add DRM, patents clauses or trademark
  restrictions beyond the licence.
- **No endorsement.** We may not say NVIDIA endorses this product.

### The model file's own licensing metadata

The model's repository card declares `license: cc-by-4.0`. The `nemo128.onnx` graph was
produced by NVIDIA's NeMo tooling (`producer = OnnxScript`), which is Apache-2.0.
Either way both are permissive and compatible with a proprietary application that
attribution is given.

## 5. Dependency licences

### Added by this work

| Dependency | Where | Licence | Why |
|---|---|---|---|
| `onnxruntime-node` | desktop only | MIT | Runs the ONNX graphs. Desktop-only, so it does not touch the mobile bundle. |
| *(none else)* | | | |

No new dependency was added to the Expo app. The SHA-256 used on the phone is our own
plain TypeScript (`_shared/sha256.ts`) precisely so that React Native, which has no
`crypto.subtle`, would not need a native crypto module.

### Already in the project

| Dependency | Licence |
|---|---|
| `whisper.rn` / `whisper.cpp` | MIT |
| `expo-*` | MIT |
| `@supabase/supabase-js` | MIT |
| `@react-native-async-storage/async-storage` | MIT |
| `react-native`, `react-native-web` | MIT |
| `electron`, `electron-builder` | MIT / MIT |
| `@supabase/supabase-js` (desktop) | MIT |

### Not added, and why

- **Python, `py3lang` or any Python runtime in the shipped product** — the desktop app
  must not need a Python install.
- **A native Rust ONNX binding** (`ort`) — this is what Murmure uses. It would mean
  shipping a Rust toolchain and a native module in our Electron build. `onnxruntime-node`
  does the same job with an MIT licence and no toolchain.

## 6. Other licences to check before shipping

| Item | Note |
|---|---|
| The Deepgram terms of service | Not changed by this work. The app already opts out of model improvement (`mip_opt_out`). |
| Anthropic's terms | Not changed. The local path does not send audio to Anthropic; see the privacy note below. |
| The `onnxruntime` binaries | MIT. `onnxruntime-node` downloads prebuilt binaries; they should be pinned and checksummed at install time. |
| The icon and font assets | Not changed by this work. |

## 7. A privacy point that is also a licensing point

The local path sends **the words** to the server so the notes can be written, but never
the audio. That is a product decision, and it means the local path is **not fully
offline** — the transcript still leaves the device. The app says so in those words.

Murmure's licensing permits use of the model in a commercial product with attribution.
Murmure's *architecture* — recording locally and never sending audio — is a design we
are adopting because it is better for users, not because of any licence requirement.

## 8. What to do before shipping

1. A lawyer confirms the three points in §3.
2. The attribution text is added to the app and to the documentation.
3. The model zip's SHA-256 is pinned in the code and in `MODEL_SETUP.md`.
4. A secret scan runs over the whole history, not just the working tree.
5. A dependency vulnerability scan runs (`npm audit`, `cargo audit` equivalent for the
   desktop's native binaries if any are added later).
