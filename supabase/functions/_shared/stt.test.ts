import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepgramParams, liveParams } from './stt.ts';

test('liveParams appends keyterms and redaction for the live stream', () => {
  const p = liveParams({ language: 'en', redact: ['pii'], keyterms: ['Hartwell', 'RFI 14'] });
  assert.equal(p.get('model'), 'nova-3');
  assert.equal(p.get('language'), 'en');
  assert.equal(p.get('redact'), 'pii');
  const keys = p.getAll('keyterm');
  assert.deepEqual(keys, ['Hartwell', 'RFI 14']);
});

test('deepgramParams turns on diarization and multichannel for the pipeline', () => {
  const p = deepgramParams({ keyterms: ['Acme'], multichannel: true });
  assert.equal(p.get('diarize'), 'true');
  assert.equal(p.get('multichannel'), 'true');
  assert.equal(p.get('keyterm'), 'Acme');
});
