// The dictation history.
//
// What was said, and when. A dictation is often private — a name, a thought, something
// that is nobody else's business — so the history stays on the computer and is not
// uploaded. It is not sent to the server, and it is not part of the recording library.

export type HistoryEntry = {
  id: string;
  /** When it was said, in milliseconds since the epoch. */
  at: number;
  /** The words. */
  text: string;
  /** How long the job took, in milliseconds. */
  tookMs: number;
  /** Which engine made the words. */
  provider: string;
  /** Whether the words were made on this computer. */
  local: boolean;
};

/** How many are kept. */
export const MAX_HISTORY = 50;

/**
 * Add an entry.
 *
 * The newest is first, and the oldest is dropped when there are too many.
 */
export function addEntry(
  history: HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  if (!entry.text.trim()) return history;
  // The same words twice in a row are one entry, so holding the key does not fill the
  // history with the same thing.
  if (history[0]?.text === entry.text && entry.at - (history[0]?.at ?? 0) < 2000)
    return history;
  return [entry, ...history].slice(0, MAX_HISTORY);
}

/** Take one entry out. */
export function removeEntry(
  history: HistoryEntry[],
  id: string,
): HistoryEntry[] {
  return history.filter((e) => e.id !== id);
}

/** Take them all out. */
export function clearHistory(): HistoryEntry[] {
  return [];
}

/** Find entries whose words contain the search. */
export function searchHistory(
  history: HistoryEntry[],
  query: string,
): HistoryEntry[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return history;
  return history.filter((e) => e.text.toLowerCase().includes(wanted));
}

/** How many words an entry has. */
export function wordCount(entry: HistoryEntry): number {
  const trimmed = entry.text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** The words as one line, for putting on the clipboard. */
export function entryText(entry: HistoryEntry): string {
  return entry.text.trim();
}
