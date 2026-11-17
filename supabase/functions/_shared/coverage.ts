// Topic-coverage measurement for detailed notes: how much of a set of expected
// (human-annotated) substantive topics is represented in the generated notes.
// Pure and deterministic; the "expected" topics come from a reviewed fixture set,
// and this file only measures recall — it makes no claim that every recording is
// complete.
export function normalizeTopic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A topic is covered when its normalized form appears inside a generated heading or
 * a generated heading appears inside it (handles short headings like "AI"). */
export function topicCovered(topic: string, generated: string[]): boolean {
  const t = normalizeTopic(topic);
  if (t.length < 3) return false;
  return generated.some((g) => {
    const n = normalizeTopic(g);
    if (n.length < 3) return false;
    return n.includes(t) || t.includes(n);
  });
}

export type Coverage = {
  matched: string[];
  missing: string[];
  total: number;
  recall: number; // 0..1
};

/** Compare the expected (annotated) topics against the generated note text (section
 * headings, key points, overview) and report how many are represented. */
export function coverageRecall(expected: string[], generated: string[]): Coverage {
  const matched = expected.filter((t) => topicCovered(t, generated));
  const missing = expected.filter((t) => !topicCovered(t, generated));
  return {
    matched,
    missing,
    total: expected.length,
    recall: expected.length ? matched.length / expected.length : 1,
  };
}

/** The combined text of a notes document, for matching against expected topics. */
export function generatedText(headings: string[], keyPoints: string[], overview: string): string[] {
  return [...headings, ...keyPoints, overview].filter(Boolean);
}