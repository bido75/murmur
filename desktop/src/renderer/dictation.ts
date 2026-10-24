// Dictation, from the window's side.
//
// The window does the recording and gives the words back; the main process owns the
// shortcuts, the overlay and the clipboard. The window never presses a key itself.
import type { Bridge } from "../shared/bridge";
import { transcribeSegment } from "./speech";

declare const window: Window & { murmur: Bridge };
const bridge = () => window.murmur;

/** What the main process says about the dictation. */
export type DictationState = {
  state: "idle" | "recording" | "working" | "error";
  level: number;
  elapsedMs: number;
  progress: number;
  error: string | null;
  text: string | null;
};

export type DictationSettings = {
  shortcuts: { action: string; binding: string; mode: string }[];
  insertMethod: "clipboard" | "paste" | "type";
  keepHistory: boolean;
};

export type HistoryEntry = {
  id: string;
  at: number;
  text: string;
  tookMs: number;
  provider: string;
  local: boolean;
};

/** What the window has to do about a dictation. */
export type DictationHandlers = {
  /** Start recording. */
  start: () => Promise<void>;
  /** Stop recording and make the words. */
  stop: () => Promise<void>;
  /** Throw the recording away. */
  cancel: () => void;
  /** The level and the time, for the overlay. */
  level: (level: number, elapsedMs: number) => void;
  /** The words are ready. */
  complete: (
    text: string,
    tookMs: number,
    provider: string,
    local: boolean,
  ) => Promise<void>;
  /** Something went wrong. */
  fail: (reason: string) => void;
  /** The user asked for the history. */
  history: () => void;
};

/**
 * Listen for the main process and do what it says.
 *
 * Everything comes back the other way through the bridge, so the window never has to
 * know about the keyboard or the clipboard.
 */
export function onDictation(handlers: DictationHandlers): () => void {
  const off = bridge().on("dictation:start", () => {
    void handlers.start();
  });
  const offStop = bridge().on("dictation:stop", () => {
    void handlers.stop();
  });
  const offCancel = bridge().on("dictation:cancel", () => handlers.cancel());
  const offError = bridge().on("dictation:error", (p) =>
    handlers.fail(String((p as { error?: string })?.error ?? "Something went wrong.")),
  );
  const offHistory = bridge().on("dictation:history", () => handlers.history());
  return () => {
    off();
    offStop();
    offCancel();
    offError();
    offHistory();
  };
}

/** The settings, as the main process has them. */
export async function dictationSettings(): Promise<DictationSettings | null> {
  return (await bridge().dictationSettings()) as DictationSettings | null;
}

/** The dictation history. */
export async function dictationHistory(): Promise<HistoryEntry[]> {
  return (await bridge().dictationHistory()) as HistoryEntry[];
}

/**
 * Read a recorded part and make the words.
 *
 * The part is read as bytes, decoded here, and each channel is read on its own: the
 * person recording on the left, the call on the right.
 */
export async function transcribeRecording(
  bytes: Uint8Array,
  offsetMs: number,
  language: string | null,
): Promise<{ text: string; utterances: { start_ms: number; end_ms: number; speaker: number; text: string }[] }> {
  const words = await transcribeSegment(bytes, offsetMs, language);
  return {
    text: words.map((w) => w.text).join(" "),
    utterances: words,
  };
}
