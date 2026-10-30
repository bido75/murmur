// The parts of the speech model that are just arithmetic, with no model and no
// runtime: reading the vocabulary, turning the model's tokens into words, and
// grouping the words into sentences.
//
// Pure, so it can be tested without the 650 MB model being installed.

/** The model rate. The mel front end expects the audio at this rate. */
export const MODEL_SAMPLE_RATE = 16000;
/** The encoder's time steps are this many frames apart: 10 ms hop, 8× subsampling. */
export const FRAME_MS = 80;

/** The vocabulary that goes with the model. */
export type Vocab = {
  /** The token for each id. */
  tokens: string[];
  /** The id that means "nothing was said here". */
  blank: number;
  /** The id that means "a word I cannot spell". */
  unknown: number;
};

/**
 * Read the vocabulary.
 *
 * Each line is a token and its number, separated by a space. A token may itself
 * contain spaces, so the split is on the last space.
 */
export function loadVocab(text: string): Vocab {
  const tokens: string[] = [];
  let blank = -1;
  let unknown = -1;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cut = line.lastIndexOf(" ");
    if (cut < 0) continue;
    const id = Number(line.slice(cut + 1));
    if (!Number.isInteger(id) || id < 0) continue;
    const token = line.slice(0, cut);
    tokens[id] = token;
    if (token === "<blk>") blank = id;
    if (token === "<unk>") unknown = id;
  }
  if (blank < 0)
    throw new Error(
      "The speech model's vocabulary is missing its blank token, so it cannot be used.",
    );
  if (unknown < 0) unknown = 0;
  return { tokens, blank, unknown };
}

/** A word that was said, and when. */
export type SpokenWord = {
  text: string;
  start_ms: number;
  end_ms: number;
  /** How sure the model was, from 0 to 1. */
  confidence: number;
};

/** A token the model produced. */
export type SpokenToken = {
  id: number;
  /** The encoder frame it was produced at. */
  frame: number;
  confidence: number;
};

/** The word boundary marker the vocabulary uses. */
const WORD_MARK = "▁";

/**
 * Turn the tokens into words.
 *
 * The model writes a word boundary as a marker character. A token that starts with
 * one begins a new word.
 */
export function tokensToWords(
  tokens: SpokenToken[],
  vocab: Vocab,
): SpokenWord[] {
  const words: SpokenWord[] = [];
  let current = "";
  let startFrame = 0;
  let confidence = 1;
  let seen = false;

  const flush = (endFrame: number) => {
    const text = current.trim();
    if (text) {
      words.push({
        text,
        start_ms: startFrame * FRAME_MS,
        end_ms: endFrame * FRAME_MS,
        confidence,
      });
    }
    current = "";
    seen = false;
  };

  for (const t of tokens) {
    const raw = vocab.tokens[t.id] ?? "";
    if (raw === "<unk>") continue;
    // The marker becomes a space, and a token that starts with one begins a word.
    const text = raw.split(WORD_MARK).join(" ");
    if (!text.trim()) continue;
    const startsWord = text.startsWith(" ");
    if (seen && startsWord) flush(t.frame);
    if (!seen) {
      startFrame = t.frame;
      confidence = t.confidence;
      seen = true;
    } else {
      // A word is only as sure as its least sure piece.
      confidence = Math.min(confidence, t.confidence);
    }
    current += text;
  }
  if (seen) flush(startFrame + 1);
  return words;
}

/**
 * Group the words into sentences.
 *
 * The end of a sentence is a full stop, a question mark or an exclamation mark. Words
 * that carry no punctuation stay with the sentence before them.
 */
export function wordsToUtterances(
  words: SpokenWord[],
): { start_ms: number; end_ms: number; text: string }[] {
  const out: { start_ms: number; end_ms: number; text: string }[] = [];
  let group: string[] = [];
  let start = 0;
  let end = 0;

  const flush = () => {
    // The words carry no spaces of their own, so they are joined with one.
    const text = group.join(" ").trim();
    if (text) out.push({ start_ms: start, end_ms: end, text });
    group = [];
  };

  for (const w of words) {
    if (!group.length) start = w.start_ms;
    group.push(w.text);
    end = w.end_ms;
    if (/[.!?]["')\]]?$/.test(w.text.trim())) flush();
  }
  flush();
  return out;
}

/** The index of the largest number. */
export function argmax(
  values: Float32Array | Int32Array,
  length: number,
): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < length; i++) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      best = i;
    }
  }
  return best;
}

/** How sure the model was about one token, from its raw logits. */
export function softmaxAt(logits: Float32Array, index: number): number {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += Math.exp(logits[i] - max);
  if (!sum) return 0;
  return Math.exp(logits[index] - max) / sum;
}
