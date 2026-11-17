// Pure action-building for the agent's mutation tools. Enforces the project's
// grounding invariant (a task is never created without a quote verify.ts finds in the
// transcript) before any write. No database or network; unit-tested.
import { findQuote, type Utterance } from './verify.ts';

export type TaskCreateArgs = {
  recording_id: string;
  text: string;
  owner?: string | null;
  due_text?: string | null;
  quote: string;
};

export type TaskCreateResult =
  | { ok: true; task: { text: string; owner: string | null; owner_basis: 'named' | 'unassigned'; due_text: string | null; quote: string; quote_ms: number; kind: 'commitment'; verified: true; needs_review: false } }
  | { ok: false; reason: string };

export function buildTaskInput(args: TaskCreateArgs, utterances: Utterance[]): TaskCreateResult {
  const text = String(args.text ?? '').trim();
  if (!text) return { ok: false, reason: 'text is required' };
  const quote = String(args.quote ?? '').trim();
  if (!quote) return { ok: false, reason: 'a quote from the transcript is required to create a task' };
  const match = findQuote(quote, utterances);
  if (!match.found || match.start_ms == null) return { ok: false, reason: 'the quote was not found in the transcript' };
  const owner = String(args.owner ?? '').trim() || null;
  return {
    ok: true,
    task: {
      text: text.slice(0, 1000),
      owner,
      owner_basis: owner ? 'named' : 'unassigned',
      due_text: String(args.due_text ?? '').trim() || null,
      quote,
      quote_ms: match.start_ms,
      kind: 'commitment',
      verified: true,
      needs_review: false,
    },
  };
}
