// Verify a generated .pptx actually contains embedded media (ppt/media/*) and report
// its slide count — for CI or a quick manual check without opening PowerPoint.
// Usage: node --experimental-strip-types scripts/verify-pptx-media.mts <file.pptx>
import { readFileSync } from 'node:fs';
import { inspectPptx } from '../supabase/functions/_shared/pptx_verify.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: verify-pptx-media <file.pptx>');
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(file));
const r = inspectPptx(bytes);
console.log(`slides: ${r.slides}`);
console.log(`embedded media: ${r.media.length} (${r.mediaBytes} bytes)`);
for (const m of r.media) console.log(`  ${m}`);
if (r.media.length === 0) {
  console.error('FAIL: no embedded media found in the deck');
  process.exit(1);
}
console.log('OK: deck contains embedded images');
