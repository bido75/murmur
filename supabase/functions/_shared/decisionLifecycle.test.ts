import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supersedesPrior } from './decisionLifecycle.ts';

test('a clearly revised decision supersedes its earlier version', () => {
  const prior = 'Use Hilti anchors for the curtain wall';
  const next = 'Use Hilti anchors for the curtain wall, not Fischer';
  assert.equal(supersedesPrior(next, [prior]), prior);
});

test('an unrelated decision does not supersede', () => {
  const priors = ['Use Hilti anchors for the curtain wall'];
  assert.equal(supersedesPrior('Order a new crane for Monday', priors), null);
});

test('a small wording change on the same subject supersedes', () => {
  const prior = 'Ship the prototype to the client by Friday';
  const next = 'Ship the prototype to the client by Thursday';
  assert.equal(supersedesPrior(next, [prior]), prior);
});

test('empty new text returns null', () => {
  assert.equal(supersedesPrior('  ', ['anything']), null);
});
