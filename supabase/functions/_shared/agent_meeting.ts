// Meeting-intelligence reasoning primitives (pure). These turn the mechanical signals
// Murmur already persists — quote grounding (verify.ts), review flags, verification
// status, commitment/suggestion kind — into the distinctions the acceptance requires of
// an agent: source-backed vs speaker opinion vs unresolved vs unanchored, and how each
// earlier commitment was resolved. No database or network; unit-tested.
export type EvidenceInput = {
  verified?: boolean;
  verificationStatus?: string | null;
  needs_review?: boolean;
  kind?: string | null;
  quote?: string | null;
  confidence?: number | null;
};

export type EvidenceKind = 'source_backed' | 'speaker_opinion' | 'unresolved_claim' | 'unanchored';

export type EvidenceLabel = { kind: EvidenceKind; reason: string };

const hasQuote = (q?: string | null): boolean => Boolean(q && q.trim().length > 0);

/**
 * Classify an item by the evidence behind it.
 *
 * - "source_backed" maps to the acceptance's "verified fact" as far as a transcript can
 *   establish it: the claim was either human-verified, or its supporting quote was found
 *   verbatim in the transcript (verify.ts findQuote). It does not assert objective truth.
 * - "speaker_opinion" is a floated suggestion or low-confidence claim — attribution.
 * - "unresolved_claim" needs review, or was rejected, or is not yet verified.
 * - "unanchored" has no supporting quote at all.
 */
export function classifyEvidence(e: EvidenceInput): EvidenceLabel {
  if (e.verificationStatus === 'verified') return { kind: 'source_backed', reason: 'human-verified' };
  if (e.verificationStatus === 'rejected') return { kind: 'unresolved_claim', reason: 'rejected on review' };
  if (e.verified === true && hasQuote(e.quote)) return { kind: 'source_backed', reason: 'quote found in transcript' };
  if (e.kind === 'suggestion' || (typeof e.confidence === 'number' && e.confidence < 0.5)) return { kind: 'speaker_opinion', reason: 'floated, not committed' };
  if (e.needs_review === true) return { kind: 'unresolved_claim', reason: 'needs review' };
  if (e.verificationStatus === 'unverified') return { kind: 'unresolved_claim', reason: 'not yet verified' };
  if (!hasQuote(e.quote)) return { kind: 'unanchored', reason: 'no supporting quote' };
  return { kind: 'unresolved_claim', reason: 'unverified' };
}

export type PriorCommitment = { text: string; ref?: string; status?: string };
export type CommitmentUpdate = { ref: string; status: 'done' | 'in_progress' | 'blocked'; note?: string | null };
export type CommitmentResolution = { prior: PriorCommitment; outcome: 'done' | 'in_progress' | 'blocked' | 'unchanged'; note?: string | null };

/** Resolve earlier commitments against the later meeting's task updates (by ref). */
export function compareCommitments(priors: PriorCommitment[], updates: CommitmentUpdate[]): CommitmentResolution[] {
  const byRef = new Map<string, CommitmentUpdate>();
  for (const u of updates ?? []) if (u.ref) byRef.set(u.ref.toUpperCase(), u);
  return (priors ?? []).map((p) => {
    const u = p.ref ? byRef.get(p.ref.toUpperCase()) : undefined;
    if (!u) return { prior: p, outcome: 'unchanged' };
    const outcome: CommitmentResolution['outcome'] = u.status === 'done' ? 'done' : u.status === 'blocked' ? 'blocked' : 'in_progress';
    return { prior: p, outcome, note: u.note ?? null };
  });
}

export type BriefTask = { text: string; owner?: string | null; due?: string | null };
export type BriefDecision = { text: string; verified?: boolean; quote?: string | null };
export type BriefInput = { openTasks: BriefTask[]; decisions: BriefDecision[]; questions: string[]; lastOverview?: string | null };

export type BriefResult = { material: string; counts: { openTasks: number; decisions: number; questions: number } };

/**
 * Assemble a bounded, deterministic pre-meeting brief from structured inputs, keeping
 * only verified decisions (never floated suggestions) and capping each list so the
 * generator's context window is respected. Pure.
 */
export function meetingBriefMaterial(input: BriefInput, caps = { tasks: 40, decisions: 20, questions: 20 }): BriefResult {
  const tasks = (input.openTasks ?? []).slice(0, caps.tasks);
  const decisions = (input.decisions ?? []).filter((d) => d.verified !== false).slice(0, caps.decisions);
  const questions = (input.questions ?? []).slice(0, caps.questions);
  const parts: string[] = [];
  if (input.lastOverview?.trim()) parts.push(`Last meeting: ${input.lastOverview.trim().slice(0, 1000)}`);
  if (tasks.length) parts.push(`Open tasks:\n${tasks.map((t) => `- ${t.text}${t.owner ? ` (${t.owner})` : ''}${t.due ? ` due ${t.due}` : ''}`).join('\n')}`);
  if (decisions.length) parts.push(`Recent decisions:\n${decisions.map((d) => `- ${d.text}`).join('\n')}`);
  if (questions.length) parts.push(`Open questions:\n${questions.map((q) => `- ${q}`).join('\n')}`);
  return { material: parts.join('\n\n'), counts: { openTasks: tasks.length, decisions: decisions.length, questions: questions.length } };
}
