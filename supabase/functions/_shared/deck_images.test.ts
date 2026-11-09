import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageBudget, imagePrompt, imageProviderConfig, imageRequest } from './deck_images.ts';

test('imageProviderConfig is null when no key is set', () => {
  assert.equal(imageProviderConfig({}), null);
  assert.equal(imageProviderConfig({ IMAGE_API_KEY: '' }), null);
});

test('imageProviderConfig uses OpenAI when IMAGE_API_KEY is present', () => {
  const c = imageProviderConfig({ IMAGE_API_KEY: 'sk-test' })!;
  assert.equal(c.name, 'openai');
  assert.equal(c.model, 'gpt-image-1');
  assert.equal(c.baseUrl, 'https://api.openai.com/v1');
});

test('imageProviderConfig falls back to OpenRouter using OPENROUTER_API_KEY', () => {
  const c = imageProviderConfig({ OPENROUTER_API_KEY: 'or-test' })!;
  assert.equal(c.name, 'openrouter');
  assert.equal(c.model, 'openai/gpt-image-1');
  assert.equal(c.baseUrl, 'https://openrouter.ai/api/v1');
});

test('imageProviderConfig honors overrides', () => {
  const custom = imageProviderConfig({ IMAGE_API_KEY: 'k', IMAGE_PROVIDER: 'openai', IMAGE_BASE_URL: 'https://img.example/v1/', IMAGE_MODEL: 'flux' })!;
  assert.equal(custom.name, 'openai');
  assert.equal(custom.baseUrl, 'https://img.example/v1');
  assert.equal(custom.model, 'flux');
});

test('imagePrompt is 16:9, text-free, style-aware and illustrative', () => {
  const p = imagePrompt({ description: 'three research pillars', style: 'corporate', illustrative: true });
  assert.match(p, /16:9 landscape/i);
  assert.match(p, /No text|no words/i);
  assert.match(p, /Visual style: corporate/i);
  assert.match(p, /three research pillars/);
  assert.match(p, /conceptual illustration/i);
});

test('imageRequest shapes OpenRouter (aspect_ratio) vs OpenAI (size) requests', () => {
  const or = imageRequest({ name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'm' }, { description: 'x', style: '', illustrative: false });
  assert.equal(or.url, 'https://openrouter.ai/api/v1/images');
  assert.ok(or.body.aspect_ratio, 'openrouter uses aspect_ratio');
  assert.ok(!('size' in or.body), 'openrouter does not use size');

  const openai = imageRequest({ name: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' }, { description: 'x', style: '', illustrative: false });
  assert.equal(openai.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(openai.body.size, '1792x1024');
  assert.equal(openai.body.response_format, 'b64_json');
});

test('imageBudget clamps to the limit and floors at zero', () => {
  assert.equal(imageBudget(10, 4), 4);
  assert.equal(imageBudget(2, 4), 2);
  assert.equal(imageBudget(5, 0), 0);
  assert.equal(imageBudget(-1, 4), 0);
});