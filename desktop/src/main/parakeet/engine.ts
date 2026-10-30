// The local speech model: Parakeet TDT 0.6B v3, running on this computer.
//
// The audio never leaves the machine. Three ONNX graphs do the work:
//
//   nemo128.onnx              the mel front end: audio -> 128 features per frame
//   encoder-model.int8.onnx   the acoustic encoder: features -> 1024 numbers per frame
//   decoder_joint-model.int8.onnx  the prediction network and the joint: one frame of
//                              the encoder plus the last token -> the next token and
//                              how many frames to wait for the one after
//
// The model is published by NVIDIA under CC BY 4.0. The graphs' names and shapes were
// read out of the model files themselves, not copied from any implementation.
//
// The decoding is greedy: at each frame the most likely token is taken, and the model
// says how many frames to wait before looking again. A frame is 80 ms, so that is how
// far apart two words can be.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FRAME_MS,
  MODEL_SAMPLE_RATE,
  argmax,
  loadVocab,
  softmaxAt,
  tokensToWords,
  wordsToUtterances,
  type SpokenToken,
  type SpokenWord,
  type Vocab,
} from "../../shared/parakeet.ts";

/** How many tokens may be emitted at one frame before the decoder moves on. */
const MAX_TOKENS_PER_STEP = 10;
/** Silence added at each end of a chunk, so the mel filter never runs off the signal. */
const EDGE_SILENCE_SAMPLES = MODEL_SAMPLE_RATE / 4;

export type ParakeetResult = {
  words: SpokenWord[];
  /** The sentences, with the times they were said. */
  utterances: { start_ms: number; end_ms: number; text: string }[];
  language: string | null;
};

export type ParakeetOptions = {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
};

/** The ORT session type, so the module can be loaded lazily. */
type Ort = typeof import("onnxruntime-node");

/**
 * The local engine.
 *
 * The three graphs are loaded once and kept. The ONNX runtime is loaded lazily, so
 * the app still starts on a machine where it is missing — the user is told what is
 * wrong instead of the app failing to open.
 */
export class ParakeetEngine {
  private ort: Ort;
  private pre: any;
  private encoder: any;
  private joint: any;
  private vocab: Vocab;

  private constructor(
    ort: Ort,
    pre: any,
    encoder: any,
    joint: any,
    vocab: Vocab,
  ) {
    this.ort = ort;
    this.pre = pre;
    this.encoder = encoder;
    this.joint = joint;
    this.vocab = vocab;
  }

  /** Load the model from its folder. */
  static async create(modelDir: string): Promise<ParakeetEngine> {
    let ort: Ort;
    try {
      // Loaded by name so the app still starts when it is not installed.
      ort = (await import("onnxruntime-node")) as unknown as Ort;
    } catch {
      throw new Error(
        "The local speech engine is not installed on this computer.",
      );
    }
    const options = {
      // The graphs are big; the CPU provider is all that is needed.
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all" as const,
    };
    const [pre, encoder, joint] = await Promise.all([
      ort.InferenceSession.create(join(modelDir, "nemo128.onnx"), options),
      ort.InferenceSession.create(
        join(modelDir, "encoder-model.int8.onnx"),
        options,
      ),
      ort.InferenceSession.create(
        join(modelDir, "decoder_joint-model.int8.onnx"),
        options,
      ),
    ]);
    const vocab = loadVocab(readFileSync(join(modelDir, "vocab.txt"), "utf8"));
    return new ParakeetEngine(ort, pre, encoder, joint, vocab);
  }

  /**
   * Read the audio.
   *
   * The audio is one channel of numbers at the model's rate.
   */
  async transcribe(
    samples: Float32Array,
    options: ParakeetOptions = {},
  ): Promise<ParakeetResult> {
    const ort = this.ort;
    if (!samples.length) return { words: [], utterances: [], language: null };

    // The mel front end reflects the signal at its edges, so it needs some signal
    // beyond the audio itself. A little silence at each end is what the model was
    // trained with.
    const padded = new Float32Array(
      samples.length + EDGE_SILENCE_SAMPLES * 2,
    );
    padded.set(samples, EDGE_SILENCE_SAMPLES);

    // 1. The mel front end: audio -> 128 features per frame.
    const features = await this.pre.run({
      waveforms: new ort.Tensor("float32", padded, [1, padded.length]),
      waveforms_lens: new ort.Tensor(
        "int64",
        BigInt64Array.from([BigInt(padded.length)]),
        [1],
      ),
    });
    const featureTensor = features.features;
    const featureLength = features.features_lens;

    // 2. The encoder: features -> 1024 numbers per frame.
    const encoded = await this.encoder.run({
      audio_signal: featureTensor,
      length: featureLength,
    });
    const encodedTensor = encoded.outputs;
    const totalFrames = Number(encodedTensor.dims[2]);
    const stride = encodedTensor.dims[1];

    // 3. The greedy decode, one encoder frame at a time.
    const vocabSize = this.vocab.tokens.length;
    const tokens: SpokenToken[] = [];
    let state1 = new Float32Array(2 * 640);
    let state2 = new Float32Array(2 * 640);
    let lastToken = this.vocab.blank;
    let frame = 0;
    let emitted = 0;

    while (frame < totalFrames) {
      if (options.signal?.aborted) throw new Error("Transcription was stopped.");
      options.onProgress?.(Math.round((frame / Math.max(1, totalFrames)) * 100));

      // One frame of the encoder, as the joint wants it.
      const slice = new Float32Array(stride);
      for (let i = 0; i < stride; i++)
        slice[i] = encodedTensor.data[i * totalFrames + frame];

      const step = await this.joint.run({
        encoder_outputs: new ort.Tensor("float32", slice, [1, stride, 1]),
        targets: new ort.Tensor("int32", Int32Array.from([lastToken]), [1, 1]),
        target_length: new ort.Tensor("int32", Int32Array.from([1]), [1]),
        input_states_1: new ort.Tensor("float32", state1, [2, 1, 640]),
        input_states_2: new ort.Tensor("float32", state2, [2, 1, 640]),
      });

      const logits = step.outputs.data as Float32Array;
      const tokenLogits = logits.subarray(0, vocabSize);
      const durationLogits = logits.subarray(vocabSize, vocabSize + 5);

      const token = argmax(tokenLogits, vocabSize);
      if (token !== this.vocab.blank) {
        tokens.push({
          id: token,
          frame,
          confidence: softmaxAt(tokenLogits, token),
        });
        lastToken = token;
        state1 = new Float32Array(
          step.output_states_1.data as Float32Array,
        );
        state2 = new Float32Array(
          step.output_states_2.data as Float32Array,
        );
        emitted += 1;
      }

      const duration = argmax(durationLogits, 5);
      if (duration > 0) {
        frame += duration;
        emitted = 0;
      } else if (token === this.vocab.blank || emitted >= MAX_TOKENS_PER_STEP) {
        // Nothing was said here, or too much was: move on so it cannot loop.
        frame += 1;
        emitted = 0;
      }
    }
    options.onProgress?.(100);

    const words = tokensToWords(tokens, this.vocab);
    return {
      words,
      utterances: wordsToUtterances(words),
      // The model is English. It is not asked what language it heard, so nothing is
      // claimed about the language.
      language: "en",
    };
  }

  /** Let the runtime free the memory it is holding. */
  async close(): Promise<void> {
    await Promise.all([
      this.pre?.release?.(),
      this.encoder?.release?.(),
      this.joint?.release?.(),
    ]);
  }
}
