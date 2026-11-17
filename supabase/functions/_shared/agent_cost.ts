// Cost/token budgeting for the agent, provider-agnostic. A rough pre-run estimator so a
// plan can be rejected before it spends tokens, plus a money estimate once rates are
// known. Pure and deterministic; the actual per-request usage is a separate runtime meter.
import type { PlanStep } from './agent_types.ts';

export type TokenEstimate = { input: number; output: number };
export type CostRates = { inputPer1k: number; outputPer1k: number }; // USD per 1k tokens

const CHARS_PER_TOKEN = 4;

/** Rough token estimate: objective + per-step arg bodies + framing, and a per-step output. */
export function estimateTokens(objective: string, steps: PlanStep[]): TokenEstimate {
  const list = steps ?? [];
  const argChars = list.reduce((acc, s) => acc + JSON.stringify(s.args ?? {}).length, 0);
  const input = Math.ceil((String(objective ?? '').length + argChars + 1200) / CHARS_PER_TOKEN);
  const output = Math.ceil(250 + list.length * 150);
  return { input, output };
}

export function estimateCost(t: TokenEstimate, rates: CostRates): number {
  return (t.input / 1000) * rates.inputPer1k + (t.output / 1000) * rates.outputPer1k;
}

/** True when the plan's estimated total tokens exceed a hard budget. */
export function overTokenBudget(t: TokenEstimate, maxTokens: number): boolean {
  return t.input + t.output > maxTokens;
}
