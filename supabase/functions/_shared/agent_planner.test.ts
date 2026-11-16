import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, planSystem, PLAN_TOOL } from './agent_planner.ts';
import { UnknownToolError, InvalidPlanError } from './agent_errors.ts';

test('a valid plan is returned as typed steps', () => {
  const out = validatePlan({ steps: [{ tool: 'projects.list', args: {} }, { tool: 'tasks.list', args: { status: 'open' } }] }, 8);
  assert.deepEqual(out, [
    { tool: 'projects.list', args: {} },
    { tool: 'tasks.list', args: { status: 'open' } },
  ]);
});

test('malformed args are coerced to an empty object', () => {
  const out = validatePlan({ steps: [{ tool: 'projects.list', args: 'not-object' }] }, 8);
  assert.deepEqual(out, [{ tool: 'projects.list', args: {} }]);
});

test('unknown tools are rejected, never executed', () => {
  assert.throws(() => validatePlan({ steps: [{ tool: 'send_all_recordings' }] }, 8), UnknownToolError);
});

test('a plan over the step budget is rejected', () => {
  assert.throws(() => validatePlan({ steps: [{ tool: 'projects.list' }, { tool: 'projects.list' }, { tool: 'projects.list' }] }, 2), InvalidPlanError);
});

test('a non-step payload is an invalid plan', () => {
  assert.throws(() => validatePlan({ notSteps: true }, 8), InvalidPlanError);
  assert.throws(() => validatePlan(null, 8), InvalidPlanError);
});

test('planSystem lists the tools the model may use', () => {
  const system = planSystem(['projects.list', 'tasks.list']);
  assert.match(system, /projects\.list, tasks\.list/);
  assert.match(system, /Never invent a tool name/);
});

test('PLAN_TOOL asks for an array of steps', () => {
  assert.equal(PLAN_TOOL.name, 'propose_plan');
  assert.equal((PLAN_TOOL.input_schema as { required: readonly string[] }).required[0], 'steps');
});
