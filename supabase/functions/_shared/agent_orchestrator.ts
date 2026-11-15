// The bounded orchestrator. It asks the planning layer for steps, validates them, and
// runs each tool — read-only tools directly, approval-gated tools by pausing. It never
// executes code, SQL, or network itself; the LLM only ever proposes a plan. Pure:
// all side effects (planning LLM, tool execution, persistence) are supplied via deps,
// so this is unit-tested with fakes.
import type { RunSummary, StepOutcome, PlanStep } from './agent_types.ts';
import { validatePlan } from './agent_planner.ts';
import { policyFor } from './agent_policies.ts';
import { resolveTool } from './agent_registry.ts';
import { reserveStep, reserveToolCall, type RunBudget } from './agent_budgets.ts';
import { AgentError, toAgentError } from './agent_errors.ts';

export type AgentDeps = {
  /** Produce a raw (untrusted) plan for the objective. In production this is llmStructured. */
  plan: (objective: string) => Promise<unknown>;
  /** Execute a validated tool by name against the current user's scoped source. */
  runTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  budget: RunBudget;
  /** Best-effort persistence/emission hook, called after each step with its outcome. */
  onStep?: (outcome: StepOutcome) => void | Promise<void>;
};

export async function runAgent(objective: string, deps: AgentDeps): Promise<RunSummary> {
  const raw = await deps.plan(objective);
  const steps: PlanStep[] = validatePlan(raw, deps.budget.maxSteps);

  const outcomes: StepOutcome[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    reserveStep(deps.budget); // cannot exceed maxSteps: validatePlan already capped it
    const def = resolveTool(step.tool);
    if (!def) {
      // validatePlan guarantees a registered tool, but stay defensively safe.
      const o: StepOutcome = { stepIndex: i, tool: step.tool, status: 'failed', error: { code: 'unknown_tool', message: `Tool "${step.tool}" is not registered` } };
      outcomes.push(o);
      await deps.onStep?.(o);
      return { status: 'failed', steps: outcomes };
    }

    const decision = policyFor(def);
    if (decision.requiresApproval) {
      const o: StepOutcome = { stepIndex: i, tool: step.tool, status: 'awaiting_approval' };
      outcomes.push(o);
      await deps.onStep?.(o);
      return { status: 'awaiting_approval', steps: outcomes };
    }

    try {
      reserveToolCall(deps.budget);
      const result = await deps.runTool(step.tool, step.args);
      const o: StepOutcome = { stepIndex: i, tool: step.tool, status: 'succeeded', result };
      outcomes.push(o);
      await deps.onStep?.(o);
    } catch (e) {
      const err: AgentError = toAgentError(e, step.tool);
      const o: StepOutcome = { stepIndex: i, tool: step.tool, status: 'failed', error: { code: err.code, message: err.message } };
      outcomes.push(o);
      await deps.onStep?.(o);
      return { status: 'failed', steps: outcomes };
    }
  }

  return { status: 'completed', steps: outcomes };
}
