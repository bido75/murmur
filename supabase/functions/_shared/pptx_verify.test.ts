import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectPptx, hasEmbeddedImages } from './pptx_verify.ts';
import { zip } from './zip.ts';

test('inspectPptx lists embedded media and slide count', () => {
  const bytes = zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'ppt/slides/slide1.xml', data: '<slide/>' },
    { name: 'ppt/slides/slide2.xml', data: '<slide/>' },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: '<rel/>' },
    { name: 'ppt/media/image1.png', data: '\x89PNG fake' },
  ]);
  const r = inspectPptx(bytes);
  assert.deepEqual(r.media, ['ppt/media/image1.png']);
  assert.equal(r.slides, 2);
  assert.ok(r.mediaBytes > 0);
  assert.equal(hasEmbeddedImages(bytes), true);
});

test('inspectPptx reports no media for a text-only deck', () => {
  const bytes = zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'ppt/slides/slide1.xml', data: '<slide/>' },
  ]);
  const r = inspectPptx(bytes);
  assert.deepEqual(r.media, []);
  assert.equal(r.slides, 1);
  assert.equal(hasEmbeddedImages(bytes), false);
});

test('inspectPptx returns empty for bytes that are not a zip', () => {
  const r = inspectPptx(new TextEncoder().encode('not a zip at all'));
  assert.deepEqual(r.media, []);
  assert.equal(r.slides, 0);
});