import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBudget, reserveStep, reserveToolCall, stepsLeft, toolCallsLeft } from './agent_budgets.ts';
import { BudgetExceededError } from './agent_errors.ts';

test('defaults are finite and bounded', () => {
  const b = newBudget();
  assert.equal(stepsLeft(b), 8);
  assert.equal(toolCallsLeft(b), 16);
});

test('reserving a step/tool call consumes budget', () => {
  const b = newBudget();
  reserveStep(b);
  reserveToolCall(b);
  assert.equal(b.stepsUsed, 1);
  assert.equal(b.toolCallsUsed, 1);
});

test('exceeding max steps throws a typed budget error', () => {
  const b = newBudget({ maxSteps: 1, stepsUsed: 1 });
  assert.throws(() => reserveStep(b), BudgetExceededError);
});

test('exceeding max tool calls throws a typed budget error', () => {
  const b = newBudget({ maxToolCalls: 0 });
  assert.throws(() => reserveToolCall(b), BudgetExceededError);
});

test('left counts never go negative', () => {
  const b = newBudget({ maxSteps: 0, maxToolCalls: 0 });
  assert.equal(stepsLeft(b), 0);
  assert.equal(toolCallsLeft(b), 0);
});
