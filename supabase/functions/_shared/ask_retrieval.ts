// Pure retrieval helpers for cross-recording "ask": turning a question into search
// keywords and selecting the transcript lines most relevant to those words. The LLM
// answer is built from these excerpts, so the excerpt selection is worth testing.
import { formatClock, formatTranscript, normalize, speakerLabel, type Utterance } from './verify.ts';

export const ASK_STOPWORDS = new Set(
  'what when where who whom why how did does do was were is are the a an and or of to in on for with about from by it its that this these those me my we our you your they them their i any anything something tell said say says during meeting call recording'.split(' '),
);

/** Query words that carry meaning (case-folded, punctuation-free, stopwords dropped). */
export function askKeywords(question: string): string[] {
  return normalize(question).split(' ').filter((w) => w.length > 1 && !ASK_STOPWORDS.has(w));
}

/** Lines that mention a query word, with one line of context either side (max 60 lines). */
export function relevantLines(utterances: Utterance[], words: string[], names: Record<string, string>): string {
  if (!words.length) return formatTranscript(utterances.slice(0, 60), names);
  const keep = new Set<number>();
  utterances.forEach((u, i) => {
    const t = ' ' + normalize(u.text) + ' ';
    if (words.some((w) => t.includes(' ' + w + ' '))) [i - 1, i, i + 1].forEach((j) => keep.add(j));
  });
  return [...keep]
    .filter((i) => i >= 0 && i < utterances.length)
    .sort((a, b) => a - b)
    .slice(0, 60)
    .map((i) => `[${formatClock(utterances[i].start_ms)}] ${speakerLabel(utterances[i].speaker, names)}: ${utterances[i].text}`)
    .join('\n');
}
