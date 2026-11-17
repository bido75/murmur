// Pure live-transcript line merging: a provisional line is replaced by its finalized
// text (never duplicated), and the window is capped. No browser or platform globals.

export type LiveLine = { text: string; final: boolean };

export function mergeLive(
  lines: LiveLine[],
  text: string,
  isFinal: boolean,
  max = 8,
): LiveLine[] {
  if (!text.trim()) return lines;
  // A provisional (non-final) tail is superseded by the next result for the same span.
  const kept =
    lines.length && !lines[lines.length - 1].final ? lines.slice(0, -1) : lines;
  return [...kept, { text: text.trim(), final: isFinal }].slice(-max);
}
