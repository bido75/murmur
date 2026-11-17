// Deterministic transcript-grounding checks for generated notes. This is the
// "evidence verification" half of the quality story: it proves that a note's
// supporting excerpt was actually spoken (and roughly when), independently of the
// generator's own `verified` flag. It is a lower bound on factual faithfulness —
// it catches invented/misfiled quotes, but a quote can be verbatim yet still be
// used out of context, which the semantic judge covers.

export type UtteranceLike = {
  text?: string;
  start_ms?: number;
  end_ms?: number;
  speaker?: number;
};

export type SectionLike = {
  heading?: string;
  paragraphs?: string[];
  quote?: string | null;
  quote_ms?: number | null;
  [key: string]: unknown;
};

export type Range = { start: number; end: number; start_ms: number };

export type TranscriptIndex = { concat: string; ranges: Range[] };

/** Collapse text to a case-folded, punctuation-free, single-spaced stream so a
 * quote matches its transcript source even if punctuation, quotes or dashes were
 * cleaned up somewhere along the way. Unicode letters and numbers are kept, so
 * this works for non-English transcripts too. */
export function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, ' ')
    .replace(/\u2026/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Join every utterance into one searchable stream and remember which character
 * range maps back to which utterance (for timestamp recovery). */
export function buildTranscriptIndex(utterances: UtteranceLike[]): TranscriptIndex {
  const parts: string[] = [];
  const ranges: Range[] = [];
  let offset = 0;
  for (const u of utterances) {
    const text = normalizeForSearch(u.text ?? '');
    if (!text) continue;
    if (parts.length) offset += 1; // the joining space
    parts.push(text);
    ranges.push({ start: offset, end: offset + text.length, start_ms: u.start_ms ?? 0 });
    offset += text.length;
  }
  return { concat: parts.join(' '), ranges };
}

export type QuoteMatch = { index: number; start_ms: number };

/** Locate a quote verbatim in the transcript. Quotes shorter than 8 normalized
 * characters are not distinctive enough to ground. */
export function findQuote(quote: string, index: TranscriptIndex): QuoteMatch | null {
  const q = normalizeForSearch(quote);
  if (q.length < 8) return null;
  const idx = index.concat.indexOf(q);
  if (idx < 0) return null;
  const range = index.ranges.find((r) => idx >= r.start && idx < r.end);
  return { index: idx, start_ms: range?.start_ms ?? -1 };
}

export type SectionVerdict = {
  heading: string;
  has_quote: boolean;
  grounded: boolean;
  quote_ms: number | null;
  actual_ms: number | null;
  drift_ms: number | null;
};

/** Verify each section's (optional) anchor quote against the transcript, and
 * measure how far the section's recorded timestamp is from where the quote was
 * actually said. */
export function verifySectionQuotes(sections: SectionLike[], utterances: UtteranceLike[]): SectionVerdict[] {
  const index = buildTranscriptIndex(utterances);
  return sections.map((s) => {
    const heading = s.heading ?? '(untitled)';
    const has_quote = typeof s.quote === 'string' && s.quote.trim().length > 0;
    if (!has_quote) {
      return { heading, has_quote: false, grounded: false, quote_ms: null, actual_ms: null, drift_ms: null };
    }
    const match = findQuote(s.quote as string, index);
    const actual_ms = match ? match.start_ms : null;
    const expected = typeof s.quote_ms === 'number' ? s.quote_ms : null;
    const drift_ms = actual_ms !== null && expected !== null ? Math.abs(actual_ms - expected) : null;
    return { heading, has_quote: true, grounded: match !== null, quote_ms: expected, actual_ms, drift_ms };
  });
}

export type Faithfulness = {
  sections: SectionVerdict[];
  total_quotes: number;
  grounded: number;
  ungrounded: number;
  grounded_pct: number;
  drift_ms_mean: number | null;
  drift_ms_max: number | null;
  /** Quotes that could not be located verbatim — the notes are paraphrasing or the
   * excerpt was invented. Human review should confirm each. */
  ungrounded_headings: string[];
};

/** Aggregate per-section verification into a single faithfulness picture. */
export function summarizeFaithfulness(verdicts: SectionVerdict[]): Faithfulness {
  const withQuotes = verdicts.filter((v) => v.has_quote);
  const grounded = withQuotes.filter((v) => v.grounded);
  const drifts = withQuotes.map((v) => v.drift_ms).filter((d): d is number => d !== null);
  return {
    sections: verdicts,
    total_quotes: withQuotes.length,
    grounded: grounded.length,
    ungrounded: withQuotes.length - grounded.length,
    grounded_pct: withQuotes.length ? grounded.length / withQuotes.length : 1,
    drift_ms_mean: drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : null,
    drift_ms_max: drifts.length ? Math.max(...drifts) : null,
    ungrounded_headings: withQuotes.filter((v) => !v.grounded).map((v) => v.heading),
  };
}