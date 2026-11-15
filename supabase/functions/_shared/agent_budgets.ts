// Execution budgets: a bounded loop must not be allowed to wander. Pure.
import { BudgetExceededError } from './agent_errors.ts';

export type RunBudget = {
  maxSteps: number;
  maxToolCalls: number;
  stepsUsed: number;
  toolCallsUsed: number;
};

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_MAX_TOOL_CALLS = 16;

export function newBudget(overrides: Partial<RunBudget> = {}): RunBudget {
  return {
    maxSteps: DEFAULT_MAX_STEPS,
    maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
    stepsUsed: 0,
    toolCallsUsed: 0,
    ...overrides,
  };
}

export function reserveStep(b: RunBudget): void {
  if (b.stepsUsed >= b.maxSteps) throw new BudgetExceededError('max steps');
  b.stepsUsed += 1;
}

export function reserveToolCall(b: RunBudget): void {
  if (b.toolCallsUsed >= b.maxToolCalls) throw new BudgetExceededError('max tool calls');
  b.toolCallsUsed += 1;
}

export function stepsLeft(b: RunBudget): number {
  return Math.max(0, b.maxSteps - b.stepsUsed);
}

export function toolCallsLeft(b: RunBudget): number {
  return Math.max(0, b.maxToolCalls - b.toolCallsUsed);
}
