import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingSteps } from './agent_resume.ts';
import { actionKeyFor } from './agent_approvals.ts';
import type { PlanStep } from './agent_types.ts';

const readA: PlanStep = { tool: 'projects.list', args: {} };
const writeB: PlanStep = { tool: 'tasks.create', args: { recording_id: 'r', text: 'x', quote: 'q' } };
const writeC: PlanStep = { tool: 'followups.send', args: { recording_id: 'r', to: ['a@x.com'] } };
const readD: PlanStep = { tool: 'tasks.list', args: { status: 'open' } };

test('remainingSteps drops decided mutations, keeps reads and undecided steps', () => {
  const plan = [readA, writeB, writeC, readD];
  const done = new Set([actionKeyFor(writeB.tool, writeB.args)]);
  const out = remainingSteps(plan, done, new Set());
  assert.deepEqual(out, [readA, writeC, readD]);
});

test('pending mutations are also dropped so no duplicate approval is raised', () => {
  const plan = [readA, writeC];
  const pending = new Set([actionKeyFor(writeC.tool, writeC.args)]);
  const out = remainingSteps(plan, new Set(), pending);
  assert.deepEqual(out, [readA]);
});

test('an empty plan stays empty', () => {
  assert.deepEqual(remainingSteps([], new Set(), new Set()), []);
});

test('reordered args still match (canonical keys)', () => {
  const plan = [{ tool: 'followups.send', args: { recording_id: 'r', to: ['a@x.com'] } }];
  const key = actionKeyFor('followups.send', { to: ['a@x.com'], recording_id: 'r' });
  assert.deepEqual(remainingSteps(plan, new Set([key]), new Set()), []);
});
