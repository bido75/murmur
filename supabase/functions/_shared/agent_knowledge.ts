// Pure Knowledge Graph helpers for the Phase 2 gap closure: cross-run entity
// resolution by alias, transcript grounding of assertions, and verification-status
// propagation. No Deno/Node APIs; unit-tested.
import { tokens } from './agent_retrieval.ts';

export type EntityIndexEntry = { id: string; name: string; aliases: string[] };

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Resolve a name to an existing entity id by canonical name or any recorded alias. */
export function resolveEntity(name: string, index: EntityIndexEntry[]): { id: string | null; matchedBy: 'name' | 'alias' | null } {
  const n = normalizeName(name);
  if (!n) return { id: null, matchedBy: null };
  for (const e of index) {
    if (normalizeName(e.name) === n) return { id: e.id, matchedBy: 'name' };
    for (const a of e.aliases) if (normalizeName(a) === n) return { id: e.id, matchedBy: 'alias' };
  }
  return { id: null, matchedBy: null };
}

export type AssertionText = { subject: string; object?: string | null; value?: string | null };

export type GroundedSourceRef = {
  recordingId: string;
  startMs: number | null;
  endMs: number | null;
  excerpt: string | null;
  verificationStatus: 'unverified';
};

/**
 * Ground an assertion in the transcript: the first utterance that mentions a substantive
 * token of the subject/value/object provides the timestamp and excerpt. Null fields when
 * nothing in the assertion appears in the transcript (the assertion is then ungrounded,
 * which the review loop is meant to catch).
 */
export function groundAssertion(recordingId: string, assertion: AssertionText, utterances: { start_ms: number; end_ms: number; text: string }[]): GroundedSourceRef {
  const terms = new Set<string>();
  for (const field of [assertion.subject, assertion.value, assertion.object]) {
    if (typeof field === 'string') for (const t of tokens(field)) if (t.length >= 2) terms.add(t);
  }
  for (const u of utterances) {
    const toks = tokens(u.text);
    if (toks.some((t) => terms.has(t))) {
      return {
        recordingId,
        startMs: u.start_ms,
        endMs: u.end_ms,
        excerpt: u.text.trim().slice(0, 200),
        verificationStatus: 'unverified',
      };
    }
  }
  return { recordingId, startMs: null, endMs: null, excerpt: null, verificationStatus: 'unverified' };
}

export type SourceRefRow = { recordingId?: string; startMs?: number | null; endMs?: number | null; excerpt?: string | null; verificationStatus?: string };

/** Bump every source ref's verification status when an assertion is accepted/rejected. */
export function withVerificationStatus(refs: SourceRefRow[], status: 'verified' | 'rejected'): SourceRefRow[] {
  return (refs ?? []).map((r) => ({ ...r, verificationStatus: status }));
}
