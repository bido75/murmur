import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTheme,
  sanitizeSlides,
  validateChartData,
  deckSystemPrompt,
  DECK_KINDS,
  type ChartSlide,
} from './deck_plan.ts';

test('resolveTheme maps a style and falls back to corporate', () => {
  assert.equal(resolveTheme('corporate').name, 'Executive Corporate');
  assert.equal(resolveTheme('tech').name, 'Technology & Innovation');
  assert.equal(resolveTheme(undefined).name, 'Executive Corporate');
  // deno-lint-ignore no-explicit-any
  assert.equal(resolveTheme('nonsense' as any).name, 'Executive Corporate');
});

test('validateChartData accepts a well-formed chart', () => {
  const c: ChartSlide = { kind: 'chart', title: 'Budget', chartType: 'bar', categories: ['A', 'B'], series: [{ name: 'x', values: [1, 2] }] };
  assert.equal(validateChartData(c), null);
});

test('validateChartData rejects invented/malformed data', () => {
  assert.ok(validateChartData({ kind: 'chart', title: 't', chartType: 'bar', categories: ['a'], series: [{ name: 'x', values: [1] }] }));
  assert.ok(validateChartData({ kind: 'chart', title: 't', chartType: 'bar', categories: ['a', 'b'], series: [{ name: 'x', values: [1] }] }), 'series length mismatch');
  assert.ok(validateChartData({ kind: 'chart', title: 't', chartType: 'bar', categories: ['a', 'b'], series: [{ name: 'x', values: [1, NaN] }] }), 'non-finite value');
  assert.ok(validateChartData({ kind: 'chart', title: 't', chartType: 'bar', categories: ['a', 'b'], series: [] }), 'no series');
});

test('sanitizeSlides keeps a valid process, timeline, pillars and chart slide', () => {
  const out = sanitizeSlides([
    { kind: 'process', title: 'How we build', steps: [{ heading: 'Design', detail: 'x' }, { heading: 'Build', detail: 'y' }, { heading: 'Ship', detail: 'z' }] },
    { kind: 'timeline', title: 'Roadmap', milestones: [{ label: 'Jan', note: 'a' }, { label: 'Mar', note: 'b' }] },
    { kind: 'pillars', title: 'Priorities', pillars: [{ heading: 'A', detail: 'x' }, { heading: 'B', detail: 'y' }] },
    { kind: 'chart', title: 'Numbers', chartType: 'bar', categories: ['Q1', 'Q2'], series: [{ name: 'r', values: [10, 20] }] },
  ]);
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((s) => s.kind), ['process', 'timeline', 'pillars', 'chart']);
});

test('sanitizeSlides drops under-filled diagrams and malformed charts', () => {
  const out = sanitizeSlides([
    { kind: 'process', title: 'Too few', steps: [{ heading: 'Only one' }] },
    { kind: 'chart', title: 'Bad chart', chartType: 'bar', categories: ['a'], series: [{ name: 'x', values: [1] }] },
    { kind: 'bullets', title: 'Plain', bullets: ['a', 'b'] },
  ]);
  assert.deepEqual(out.map((s) => s.kind), ['bullets'], 'process with 1 step and malformed chart dropped');
});

test('sanitizeSlides coerces chart values to numbers and drops non-numeric', () => {
  const out = sanitizeSlides([
    { kind: 'chart', title: 'Nums', chartType: 'line', categories: ['a', 'b'], series: [{ name: 's', values: ['3', '4'] }] },
  ]);
  assert.ok(out.length, 'numeric strings are coerced');
  if (out.length && out[0].kind === 'chart') assert.deepEqual(out[0].series[0].values, [3, 4]);
});

test('sanitizeSlides caps the slide count', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'bullets', title: `Slide ${i}`, bullets: ['a'] }));
  assert.equal(sanitizeSlides(many).length, 12);
});

test('the deck prompt forbids inventing data and steers visual layout by meaning', () => {
  const p = deckSystemPrompt('client_update', null);
  assert.match(p, /Never invent numbers/);
  assert.match(p, /chart ONLY when the material states real numbers/);
  assert.match(p, /native, editable diagrams/);
});

test('all four deck kinds are defined', () => {
  assert.deepEqual(Object.keys(DECK_KINDS).sort(), ['client_update', 'pitch', 'proposal', 'site_report']);
});