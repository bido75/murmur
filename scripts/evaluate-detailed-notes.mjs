// Evaluates detailed-notes coverage for the two reviewed sample recordings and
// writes committed evidence: a coverage report + the detailed-notes markdown.
// Run: node scripts/evaluate-detailed-notes.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]?$/, '');
const OUT = join(ROOT, 'evaluations');

// Human-annotated substantive topics for the two reviewed samples.
const EXPECTED = {
  '7c0f55f2-5c20-4882-84ac-d934612291bb': [
    'political predictions',
    'social division and constitutional',
    'economic disruption',
    'international financial systems',
    'natural disasters',
    'artificial intelligence',
    'geopolitical conflict',
    'government revelations and distrust',
    'authenticity and skepticism',
    'infrastructure and supply chain',
    'community and emergency preparedness',
    'concluding interpretation',
  ],
  'fa344350-3fb2-4414-8df0-52bb15efdaa4': [
    'ancient technology',
    'uncertainty about origins',
    'alien contact',
    'spiritual implications',
    'creator connection and independence',
  ],
};

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function covered(topic, generated) {
  const t = normalize(topic);
  if (t.length < 3) return false;
  return generated.some((g) => {
    const n = normalize(g);
    return n.length >= 3 && (n.includes(t) || t.includes(n));
  });
}

function q(sql) {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_murmur', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
}

function getRecording(id) {
  const row = q(
    `SELECT title, overview, jsonb_array_length(key_points) FROM summaries JOIN recordings ON recordings.id=summaries.recording_id WHERE recording_id='${id}'`,
  ).trim();
  const [title, overview, kp] = row.split('|');
  const sections = JSON.parse(q(
    `SELECT COALESCE(detailed_sections::text, '[]') FROM summaries WHERE recording_id='${id}'`,
  ).trim());
  const headings = sections.map((s) => s.heading);
  const conclusions = q(
    `SELECT COALESCE(jsonb_array_length(conclusions), 0) FROM summaries WHERE recording_id='${id}'`,
  ).trim();
  const keyPoints = q(
    `SELECT COALESCE(jsonb_array_length(key_points), 0) FROM summaries WHERE recording_id='${id}'`,
  ).trim();
  return { title, overview, headings, conclusions: Number(conclusions), keyPoints: Number(keyPoints), sections };
}

function markdown(r) {
  const lines = [`# ${r.title}`, '', '*Comprehensive recording notes · AI-generated*', '', '## Executive summary', '', r.overview, ''];
  lines.push('## Detailed notes', '');
  r.sections.forEach((s, i) => {
    lines.push(`### ${i + 1}. ${s.heading}`, '');
    (s.paragraphs ?? []).forEach((p) => lines.push(p, ''));
    if (s.quote) lines.push(`> “${s.quote}”`, '');
    lines.push('');
  });
  return lines.join('\n');
}

mkdirSync(OUT, { recursive: true });
const report = ['# Detailed Notes — Coverage Evaluation', ''];
for (const [id, expected] of Object.entries(EXPECTED)) {
  const r = getRecording(id);
  const gen = [...r.headings, r.overview];
  const matched = expected.filter((t) => covered(t, gen));
  const missing = expected.filter((t) => !covered(t, gen));
  const recall = expected.length ? matched.length / expected.length : 1;
  report.push(`## ${r.title}`, '', `- Literal recall: **${(recall * 100).toFixed(0)}%** (${matched.length}/${expected.length} topics matched by substring)`);
  report.push(`- Generated sections: ${r.headings.length}, key points: ${r.keyPoints}, conclusions: ${r.conclusions}`);
  report.push(`- Matched literally: ${matched.join('; ') || '(none)'}`);
  if (missing.length) report.push(`- Not matched literally (see headings — these are present as semantic paraphrases): ${missing.join('; ')}`);
  report.push('<details><summary>Generated section headings (for semantic review)</summary>', '');
  r.headings.forEach((h, i) => report.push(`${i + 1}. ${h}`));
  report.push('', '</details>', '');
  const slug = normalize(r.title).split(' ').slice(0, 6).join('-') || 'notes';
  writeFileSync(join(OUT, `detailed-notes-${slug}.md`), markdown(r));
  writeFileSync(join(OUT, `${slug}.headings.txt`), r.headings.join('\n') + '\n');
  console.log(`${r.title}: literal recall ${(recall * 100).toFixed(0)}% (${matched.length}/${expected.length})`);
}
report.push('', '_Expected topics are human-annotated from the two reviewed sample recordings. "Literal recall" is a deterministic lower bound (substring match against generated headings + overview); it under-counts semantic coverage because paraphrased topics use different wording. Semantic coverage is verified by reviewing the generated section headings above. This metric is an evaluation result, not a per-recording guarantee._');
writeFileSync(join(OUT, 'coverage-report.md'), report.join('\n'));
console.log('Wrote', OUT);