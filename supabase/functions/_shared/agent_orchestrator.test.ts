import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from './agent_orchestrator.ts';
import { newBudget } from './agent_budgets.ts';
import type { StepOutcome } from './agent_types.ts';

test('runs a validated plan to completion, in order', async () => {
  const calls: string[] = [];
  const outcomes: StepOutcome[] = [];
  const summary = await runAgent('list my projects and open tasks', {
    plan: async () => ({ steps: [{ tool: 'projects.list', args: {} }, { tool: 'tasks.list', args: { status: 'open' } }] }),
    runTool: async (tool) => {
      calls.push(tool);
      return { ok: tool };
    },
    budget: newBudget(),
    onStep: (o) => void outcomes.push(o),
  });
  assert.equal(summary.status, 'completed');
  assert.deepEqual(calls, ['projects.list', 'tasks.list']);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].status, 'succeeded');
  assert.equal(outcomes[1].status, 'succeeded');
});

test('a failure stops the run and reports the failed step', async () => {
  const summary = await runAgent('x', {
    plan: async () => ({ steps: [{ tool: 'projects.list' }, { tool: 'tasks.list' }] }),
    runTool: async (tool) => {
      if (tool === 'projects.list') throw new Error('boom');
      return { ok: true };
    },
    budget: newBudget(),
  });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.steps.length, 1);
  assert.equal(summary.steps[0].error?.code, 'tool_failed');
  assert.match(summary.steps[0].error!.message, /projects\.list: boom/);
});

test('exceeding the tool-call budget stops the run with a budget error', async () => {
  const summary = await runAgent('x', {
    plan: async () => ({ steps: [{ tool: 'projects.list' }, { tool: 'projects.list' }, { tool: 'projects.list' }] }),
    runTool: async () => ({ ok: true }),
    budget: newBudget({ maxSteps: 8, maxToolCalls: 2 }),
  });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.steps[2].error?.code, 'budget_exceeded');
});

test('an invalid plan (unknown tool) surfaces a typed error', async () => {
  await assert.rejects(
    () =>
      runAgent('x', {
        plan: async () => ({ steps: [{ tool: 'hack' }] }),
        runTool: async () => ({}),
        budget: newBudget(),
      }),
    /not registered/,
  );
});

test('a write tool pauses for approval and is never executed', async () => {
  const called: string[] = [];
  const summary = await runAgent('x', {
    plan: async () => ({
      steps: [{ tool: 'projects.list' }, { tool: 'tasks.update', args: { task_id: '20000000-0000-0000-0000-000000000001', status: 'done' as const } }],
    }),
    runTool: async (tool) => {
      called.push(tool);
      return { ok: true };
    },
    budget: newBudget(),
  });
  assert.equal(summary.status, 'awaiting_approval');
  assert.deepEqual(called, ['projects.list']);
  const pending = summary.steps.find((s) => s.status === 'awaiting_approval')!;
  assert.equal(pending.tool, 'tasks.update');
  assert.deepEqual(pending.args, { task_id: '20000000-0000-0000-0000-000000000001', status: 'done' });
});
