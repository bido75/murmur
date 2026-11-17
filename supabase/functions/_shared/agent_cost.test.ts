import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, estimateTokens, overTokenBudget } from './agent_cost.ts';
import type { PlanStep } from './agent_types.ts';

test('estimateTokens grows with the objective and step count', () => {
  const small = estimateTokens('hi', []);
  const big = estimateTokens('x'.repeat(4000), [{ tool: 'notes.retrieve', args: { recording_id: 'r' } }, { tool: 'tasks.list', args: {} }]);
  assert.ok(big.input > small.input);
  assert.ok(big.output > small.output);
});

test('overTokenBudget compares total tokens', () => {
  assert.equal(overTokenBudget({ input: 100, output: 100 }, 250), false);
  assert.equal(overTokenBudget({ input: 200, output: 100 }, 250), true);
});

test('estimateCost applies per-1k rates', () => {
  // 1000 input + 0 output at $0.003 in / $0.015 out
  const cost = estimateCost({ input: 1000, output: 0 }, { inputPer1k: 0.003, outputPer1k: 0.015 });
  assert.equal(cost, 0.003);
  const cost2 = estimateCost({ input: 0, output: 2000 }, { inputPer1k: 0.003, outputPer1k: 0.015 });
  assert.equal(cost2, 0.03);
});
