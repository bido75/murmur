// Plan prompt/schema and validation of the model's (untrusted) plan. Pure.
import type { PlanStep } from './agent_types.ts';
import { policyFor } from './agent_policies.ts';
import { resolveTool } from './agent_registry.ts';
import { InvalidPlanError, ToolNotAllowedError, UnknownToolError } from './agent_errors.ts';

export const PLAN_TOOL = {
  name: 'propose_plan',
  description: 'Propose the ordered steps the agent should take.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tool: { type: 'string', description: 'One of the available tools.' },
            args: { type: 'object', description: 'Arguments for that tool.' },
          },
          required: ['tool'],
        },
      },
    },
    required: ['steps'],
  },
} as const;

export function planSystem(toolNames: string[]): string {
  return [
    'You are the planning layer of a meeting-intelligence assistant.',
    'Produce an ordered list of steps that accomplishes the user\'s objective using ONLY the tools listed below, each with its arguments.',
    'Work broad to narrow: list/search first, then read the specific recordings, notes, transcripts or tasks that answer the objective.',
    'Prefer the fewest steps. Never invent a tool name. Never assume data you have not retrieved.',
    `Available tools: ${toolNames.join(', ')}.`,
  ].join('\n');
}

export function planMessages(objective: string) {
  return [{ role: 'user' as const, content: `Objective: ${String(objective).slice(0, 2000)}\n\nReturn the plan.` }];
}

/**
 * Validate a model-produced plan against the registry and budget:
 * - the payload must be a steps array,
 * - it must not exceed maxSteps,
 * - every tool must exist and be allowed by policy,
 * - args are coerced to a plain object (missing/malformed args become {}).
 * Throws a typed AgentError (never returns a plan that could execute an unknown tool).
 */
export function validatePlan(raw: unknown, maxSteps: number): PlanStep[] {
  const steps = raw && typeof raw === 'object' ? (raw as { steps?: unknown }).steps : undefined;
  if (!Array.isArray(steps)) throw new InvalidPlanError('the model did not return a plan with steps');
  if (steps.length > maxSteps) throw new InvalidPlanError(`plan has ${steps.length} steps; the limit is ${maxSteps}`);

  const out: PlanStep[] = [];
  for (const s of steps) {
    if (!s || typeof s !== 'object') continue;
    const tool = (s as { tool?: unknown }).tool;
    if (typeof tool !== 'string' || !tool.trim()) continue;
    const def = resolveTool(tool.trim());
    if (!def) throw new UnknownToolError(tool.trim());
    const decision = policyFor(def);
    if (!decision.allowed) throw new ToolNotAllowedError(def.name, decision.reason ?? 'not allowed by policy');
    const args = (s as { args?: unknown }).args;
    const plainArgs = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    out.push({ tool: def.name, args: plainArgs });
  }
  return out;
}
