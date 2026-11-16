// Grounded retrieval and citation helpers for the agent. Pure and provider-agnostic.
//
// These produce utterance-level citations (recording + timestamp + excerpt) from
// transcripts and rerank keyword-recall results deterministically. Semantic embedding
// reranking is intentionally out of scope here: it is an optional, provider-backed
// upgrade layered on top of rankSearchHits, not a replacement for it.
import type { Utterance } from './verify.ts';
import { normalize, speakerLabel } from './verify.ts';

const STOPWORDS = new Set(
  'a an the and or but so to of in on at for by with it its is are was were be been i you he she we they me us them my your our their this that these those there here do does did will would can could should not no yes ok okay um uh just'.split(' '),
);

const NEGATIONS = new Set(
  'not no never without wont cant cannot dont does not do not did not isnt is not arent are not cancel stop remove revert rescind drop discontinue'.split(' '),
);

/** All normalized tokens, punctuation-free, contraction-expanded, stopwords kept. */
export function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** Meaningful tokens (stopwords dropped, one character or shorter dropped, deduped). */
export function contentTerms(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens(text)) {
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Split a multi-part question into sub-queries, each as its own term list. */
export function decomposeQuery(question: string): string[][] {
  const clauses = String(question)
    .split(/[;,?]|\band\b|\bor\b|\bvs\.?\b|\bthen\b|\balso\b/i)
    .map((c) => c.trim())
    .filter(Boolean);
  if (clauses.length <= 1) return [contentTerms(question)].filter((t) => t.length);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const c of clauses) {
    const terms = contentTerms(c);
    if (!terms.length) continue;
    const key = terms.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(terms);
  }
  return out.length ? out : [contentTerms(question)];
}

export type UtteranceCitation = {
  start_ms: number;
  end_ms: number;
  excerpt: string;
  speaker: string;
  score: number; // fraction of query terms present, 0..1
};

function excerpt(text: string, max = 200): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Rank utterances by how many query terms they mention, and return the matching ones
 * as citations (timestamp + speaker + excerpt). Empty when nothing matches.
 */
export function utteranceCitations(utterances: Utterance[], queryTerms: string[], speakerNames: Record<string, string> = {}, limit = 20): UtteranceCitation[] {
  const terms = queryTerms.filter((t) => t.length >= 2);
  if (!terms.length || !utterances.length) return [];
  const scored: UtteranceCitation[] = [];
  for (const u of utterances) {
    const toks = new Set(tokens(u.text));
    let hits = 0;
    for (const t of terms) if (toks.has(t)) hits++;
    if (!hits) continue;
    scored.push({
      start_ms: u.start_ms,
      end_ms: u.end_ms,
      excerpt: excerpt(u.text),
      speaker: speakerLabel(u.speaker, speakerNames),
      score: hits / terms.length,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.start_ms - b.start_ms);
  return scored.slice(0, limit);
}

export type SearchHit = {
  recording_id: string;
  title: string;
  snippet?: string | null;
  at_ms?: number | null;
  [key: string]: unknown;
};

export type RankedHit = SearchHit & { score: number };

/** Deterministic rerank of keyword recall by title+snippet overlap (0..1, ties keep order). */
export function rankSearchHits(hits: SearchHit[], queryTerms: string[]): RankedHit[] {
  const terms = queryTerms.filter((t) => t.length >= 2);
  return hits
    .map((h, i) => {
      const text = `${h.title ?? ''} ${h.snippet ?? ''}`;
      const toks = new Set(tokens(text));
      let hits2 = 0;
      for (const t of terms) if (toks.has(t)) hits2++;
      return { ...h, score: terms.length ? hits2 / terms.length : 0, __order: i } as RankedHit & { __order: number };
    })
    .sort((a, b) => b.score - a.score || a.__order - b.__order)
    .map(({ __order: _o, ...rest }) => rest as RankedHit);
}

/** True when no citation clears the minimum relevance bar — the agent must then say so. */
export function insufficientEvidence(citations: UtteranceCitation[], minScore = 0.5): boolean {
  return !citations.some((c) => c.score >= minScore);
}

/** Conservative, deterministic contradiction: both sides substantive, at least one
 * shared content term, and exactly one side carries a negation marker. A lower bound —
 * it surfaces possible conflicts for review, never resolves them. */
export function contradicts(a: string, b: string): boolean {
  const ca = contentTerms(a);
  const cb = contentTerms(b);
  if (ca.length < 2 || cb.length < 2) return false;
  const overlap = ca.filter((t) => cb.includes(t));
  if (overlap.length < 1) return false;
  const negA = tokens(a).some((t) => NEGATIONS.has(t));
  const negB = tokens(b).some((t) => NEGATIONS.has(t));
  return negA !== negB;
}

export type SourceRef = {
  recordingId: string;
  startMs: number | null;
  endMs: number | null;
  excerpt: string | null;
  verificationStatus: 'unverified' | 'verified' | 'rejected';
};

/** A KG-ready source reference from a citation (the schema `source_refs` documents). */
export function sourceRef(recordingId: string, citation: UtteranceCitation, verificationStatus: SourceRef['verificationStatus'] = 'unverified'): SourceRef {
  return { recordingId, startMs: citation.start_ms, endMs: citation.end_ms, excerpt: citation.excerpt, verificationStatus };
}
