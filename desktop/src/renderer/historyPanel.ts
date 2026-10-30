// The dictation history.
//
// What was said, and when. It stays on this computer: it is not uploaded and it is not
// part of the recording library.
import type { Bridge } from "../shared/bridge";
import type { HistoryEntry } from "./dictation";

declare const window: Window & { murmur: Bridge };
const bridge = () => window.murmur;

export type HistoryHandlers = {
  /** The history changed, so the panel is put back the way it was. */
  changed: (entries: HistoryEntry[]) => void;
  /** Something went wrong. */
  error: (message: string) => void;
};

/**
 * The history, and the things that can be done with it.
 *
 * The words go on the clipboard; the main process does the copying, so the window never
 * touches the clipboard itself.
 */
export function useHistory(handlers: HistoryHandlers): {
  load: () => Promise<HistoryEntry[]>;
  search: (query: string) => Promise<HistoryEntry[]>;
  copy: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  pasteLast: () => Promise<void>;
} {
  const load = async () => {
    try {
      const entries = (await bridge().dictationHistory()) as HistoryEntry[];
      handlers.changed(entries);
      return entries;
    } catch (e) {
      handlers.error((e as Error).message);
      return [];
    }
  };

  const search = async (query: string) => {
    try {
      const entries = (await bridge().dictationSearch(query)) as HistoryEntry[];
      handlers.changed(entries);
      return entries;
    } catch (e) {
      handlers.error((e as Error).message);
      return [];
    }
  };

  const copy = async (id: string) => {
    try {
      await bridge().dictationCopy(id);
    } catch (e) {
      handlers.error((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    await bridge().dictationRemove(id);
    await load();
  };

  const clear = async () => {
    await bridge().dictationClear();
    await load();
  };

  const pasteLast = async () => {
    try {
      await bridge().dictationPasteLast();
    } catch (e) {
      handlers.error((e as Error).message);
    }
  };

  return { load, search, copy, remove, clear, pasteLast };
}

/** How long ago something was, in words. */
export function timeAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** How many words an entry has. */
export function words(entry: HistoryEntry): number {
  const trimmed = entry.text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** How the entry was made, in words. */
export function howMade(entry: HistoryEntry): string {
  return entry.local ? "on this computer" : "in the cloud";
}
