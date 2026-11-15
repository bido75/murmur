import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionKeyFor, buildApproval, canonicalArgs, matchesApproval } from './agent_approvals.ts';

test('canonicalization is independent of key order', () => {
  assert.equal(canonicalArgs({ a: 1, b: 2 }), canonicalArgs({ b: 2, a: 1 }));
});

test('action key binds the tool to its exact arguments', () => {
  assert.equal(actionKeyFor('followups.send', { to: 'a@x.com' }), actionKeyFor('followups.send', { to: 'a@x.com' }));
  assert.notEqual(actionKeyFor('followups.send', { to: 'a@x.com' }), actionKeyFor('followups.send', { to: 'b@x.com' }));
  assert.notEqual(actionKeyFor('tasks.create', { to: 'a@x.com' }), actionKeyFor('followups.send', { to: 'a@x.com' }));
});

test('an approval matches only the identical tool + args', () => {
  const approval = buildApproval('followups.send', { to: 'a@x.com' }, '2026-11-16T00:00:00Z');
  assert.equal(matchesApproval('followups.send', { to: 'a@x.com' }, approval), true);
  assert.equal(matchesApproval('followups.send', { to: 'b@x.com' }, approval), false);
  assert.equal(matchesApproval('tasks.create', { to: 'a@x.com' }, approval), false);
});
