import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageBudget, imagePrompt, imageProviderConfig } from './deck_images.ts';

test('imageProviderConfig is null when no key is set', () => {
  assert.equal(imageProviderConfig({}), null);
  assert.equal(imageProviderConfig({ IMAGE_API_KEY: '' }), null);
});

test('imageProviderConfig resolves defaults and overrides', () => {
  const c = imageProviderConfig({ IMAGE_API_KEY: 'sk-test' })!;
  assert.equal(c.name, 'openai');
  assert.equal(c.model, 'gpt-image-1');
  assert.equal(c.baseUrl, 'https://api.openai.com/v1');
  const custom = imageProviderConfig({ IMAGE_API_KEY: 'k', IMAGE_PROVIDER: 'acme', IMAGE_BASE_URL: 'https://img.example/v1/', IMAGE_MODEL: 'flux' })!;
  assert.equal(custom.name, 'acme');
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

test('imageBudget clamps to the limit and floors at zero', () => {
  assert.equal(imageBudget(10, 4), 4);
  assert.equal(imageBudget(2, 4), 2);
  assert.equal(imageBudget(5, 0), 0);
  assert.equal(imageBudget(-1, 4), 0);
});