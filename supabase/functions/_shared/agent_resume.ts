// Idempotent resume: given a persisted plan and the actions already decided (done or
// pending), return the steps that still need to run. Reads re-run safely (idempotent);
// mutations are skipped once their action key is decided, so replay never repeats an
// external side effect or re-raises an already-answered approval. Pure.
import { actionKeyFor } from './agent_approvals.ts';
import type { PlanStep } from './agent_types.ts';

export function remainingSteps(plan: PlanStep[], doneKeys: ReadonlySet<string>, pendingKeys: ReadonlySet<string>): PlanStep[] {
  return (plan ?? []).filter((s) => {
    const k = actionKeyFor(s.tool, s.args);
    return !doneKeys.has(k) && !pendingKeys.has(k);
  });
}
