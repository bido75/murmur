import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  insecurePageMessage,
  micProblem,
  noBrowserSupportMessage,
} from '../../supabase/functions/_shared/mic_permission.ts';

test('a page that is not secure is told why the microphone is missing', () => {
  // The rule the browser follows: a page only gets a microphone on a secure page.
  // `navigator.mediaDevices` is not there at all otherwise.
  //
  // The message must say the page is not secure, because "try another browser" sends
  // people down the wrong road: every browser behaves the same way here.
  const message = insecurePageMessage();
  assert.match(message, /not secure/i);
  assert.match(message, /https/);
  assert.ok(
    !/try a current version/i.test(message),
    'it does not blame the browser',
  );
});

test('a browser that genuinely cannot record is still told what to try', () => {
  const message = noBrowserSupportMessage();
  assert.match(message, /Chrome/);
  assert.match(message, /Safari/);
});

test('the problem the browser reported is read from its own name', () => {
  assert.equal(micProblem('NotAllowedError'), 'blocked');
  assert.equal(micProblem('NotFoundError'), 'no-device');
  assert.equal(micProblem('NotReadableError'), 'in-use');
  // A page that is not secure never reaches getUserMedia, so the browser reports
  // nothing at all. That is a different case from a browser that cannot record.
  assert.equal(micProblem(undefined), 'unknown');
  assert.equal(micProblem(null), 'unknown');
});

test('the two problems are told apart', () => {
  // The one for a page that is not secure and the one for a browser that cannot
  // record are different problems, and must not read the same.
  assert.notEqual(insecurePageMessage(), noBrowserSupportMessage());
});
