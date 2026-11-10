// Semantic quality evaluation: semantic completeness + factual faithfulness.
// Deterministic quote/timestamp grounding (faithfulness.ts) is the evidence layer;
// an LLM judge (semantic.ts) does meaning-based coverage and hallucination checks.
// Writes human-reviewable evidence to evaluations/quality-report.{md,json}.
//
// Run: node --experimental-strip-types scripts/evaluate-notes-quality.mts

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  summarizeFaithfulness,
  verifySectionQuotes,
  type SectionLike,
  type UtteranceLike,
} from '../supabase/functions/_shared/faithfulness.ts';
import {
  claimExtractionPrompt,
  coverageExtractionPrompt,
  coverageJudgmentPrompt,
  faithfulnessJudgmentPrompt,
  factualFaithfulness,
  semanticRecall,
  splitForJudgement,
  CLAIM_SCHEMA,
  COVERAGE_JUDGE_SCHEMA,
  FAITHFULNESS_JUDGE_SCHEMA,
  POINT_SCHEMA,
  type CoverageVerdict,
  type FaithfulnessVerdict,
} from '../supabase/functions/_shared/semantic.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]?$/, '');
const OUT = join(ROOT, 'evaluations');

// The reviewed sample recordings. They are regression inputs only — the evaluator,
// like the generator, is recording-agnostic.
const RECORDINGS = [
  '7c0f55f2-5c20-4882-84ac-d934612291bb',
  'fa344350-3fb2-4414-8df0-52bb15efdaa4',
];

function q(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_murmur', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
}

function loadEnv(): Record<string, string> {
  const p = join(ROOT, 'supabase', 'functions', '.env');
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error(`model returned non-JSON: ${candidate.slice(0, 300)}`);
  }
}

async function askStructured(
  env: Record<string, string>,
  prompt: { system: string; user: string },
  schema: unknown,
): Promise<any> {
  const body = {
    model: env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5',
    messages: [
      { role: 'system', content: `${prompt.system}\n\nAnswer with JSON only, in exactly this shape:\n${JSON.stringify(schema)}` },
      { role: 'user', content: prompt.user },
    ],
    max_tokens: 8000,
    response_format: { type: 'json_object' },
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM call failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return parseJson(j?.choices?.[0]?.message?.content ?? '');
}

function fmtMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function transcriptText(utterances: UtteranceLike[], speakerNames: Record<string, string> | null): string {
  return utterances
    .map((u) => {
      const who = speakerNames?.[String(u.speaker ?? 0)] ?? (u.speaker != null ? `Speaker ${u.speaker}` : '');
      return `${who ? who + ' ' : ''}[${fmtMs(u.start_ms ?? 0)}] ${u.text}`;
    })
    .join('\n');
}

function notesText(
  sections: SectionLike[],
  overview: string,
  keyPoints: { text: string }[],
  conclusions: string[] | null,
): string {
  const parts = [overview.trim()].filter(Boolean);
  for (const k of keyPoints) parts.push(`- ${k.text}`);
  for (const s of sections) {
    parts.push(`## ${s.heading}`);
    for (const p of s.paragraphs ?? []) parts.push(p);
  }
  for (const c of conclusions ?? []) parts.push(`- ${c}`);
  return parts.join('\n');
}

async function evaluateRecording(env: Record<string, string>, id: string) {
  const title = q(`SELECT COALESCE(title,'') FROM recordings WHERE id='${id}'`).trim();
  const overview = q(`SELECT COALESCE(overview,'') FROM summaries WHERE recording_id='${id}'`).trim();

  let sections: SectionLike[] = [];
  let conclusions: string[] | null = null;
  let keyPoints: { text: string }[] = [];
  try {
    sections = JSON.parse(q(`SELECT COALESCE(detailed_sections::text,'[]') FROM summaries WHERE recording_id='${id}'`).trim());
    conclusions = JSON.parse(q(`SELECT COALESCE(conclusions::text,'[]') FROM summaries WHERE recording_id='${id}'`).trim());
    keyPoints = JSON.parse(q(`SELECT COALESCE(key_points::text,'[]') FROM summaries WHERE recording_id='${id}'`).trim());
  } catch {
    sections = [];
  }

  let utterances: UtteranceLike[] = [];
  let speakerNames: Record<string, string> | null = null;
  try {
    utterances = JSON.parse(q(`SELECT COALESCE(utterances::text,'[]') FROM transcripts WHERE recording_id='${id}'`).trim());
    const sn = q(`SELECT COALESCE(speaker_names::text,'{}') FROM transcripts WHERE recording_id='${id}'`).trim();
    if (sn) speakerNames = JSON.parse(sn);
  } catch {
    utterances = [];
  }

  const transcript = transcriptText(utterances, speakerNames);

  // 1) Deterministic evidence verification: quote grounding + timestamp drift.
  const verdicts = verifySectionQuotes(sections, utterances);
  const faithfulness = summarizeFaithfulness(verdicts);

  // 2) LLM semantic judge.
  const coverpoints: { id: string; statement: string }[] = [];
  if (transcript.trim()) {
    const chunks = splitForJudgement(transcript, 30_000);
    let n = 0;
    for (const chunk of chunks) {
      const p = await askStructured(env, coverageExtractionPrompt(chunk), POINT_SCHEMA);
      for (const point of p.points ?? []) {
        coverpoints.push({ id: `p${++n}`, statement: String(point.statement ?? '') });
      }
    }
  }

  const notes = notesText(sections, overview, keyPoints, conclusions);
  const coverageJudgments = coverpoints.length
    ? (await askStructured(env, coverageJudgmentPrompt(coverpoints, notes), COVERAGE_JUDGE_SCHEMA)).judgments
    : [];
  const coverage = semanticRecall((coverageJudgments ?? []).map((j: any) => ({ verdict: j.verdict as CoverageVerdict })));

  const claimsOut = notes.trim()
    ? await askStructured(env, claimExtractionPrompt(notes), CLAIM_SCHEMA)
    : null;
  const claims: { id: string; statement: string }[] = (claimsOut?.claims ?? []).map((c: any, i: number) => ({
    id: String(c.id ?? `c${i + 1}`),
    statement: String(c.statement ?? ''),
  }));

  // Judge claims against every transcript chunk, then keep the strongest support.
  const transcriptChunks = transcript.trim() ? splitForJudgement(transcript, 30_000) : [];
  const claimJudgments: Record<string, FaithfulnessVerdict> = {};
  const claimNotes: Record<string, string> = {};
  for (const chunk of transcriptChunks) {
    const out = await askStructured(env, faithfulnessJudgmentPrompt(claims, chunk), FAITHFULNESS_JUDGE_SCHEMA);
    for (const j of out.judgments ?? []) {
      const rank = { supported: 2, partially_supported: 1, unsupported: 0 }[j.verdict] ?? 0;
      const prev = { supported: 2, partially_supported: 1, unsupported: 0 }[claimJudgments[j.claim_id] ?? 'unsupported'];
      if (rank >= prev) {
        claimJudgments[j.claim_id] = j.verdict as FaithfulnessVerdict;
        claimNotes[j.claim_id] = String(j.note ?? '');
      }
    }
  }
  const claimVerdicts = claims.map((c) => ({
    claim: c,
    verdict: claimJudgments[c.id] ?? 'unsupported' as FaithfulnessVerdict,
    note: claimNotes[c.id] ?? '',
  }));
  const factuality = factualFaithfulness(claimVerdicts);

  return {
    recording_id: id,
    title,
    deterministic: {
      quote_grounding: faithfulness,
      verdicts: verdicts.map((v) => ({ ...v })),
    },
    semantic: {
      points: coverpoints,
      judgments: coverageJudgments,
      result: coverage,
    },
    factual: {
      claims,
      judgments: claimVerdicts,
      result: factuality,
    },
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

async function main() {
  const env = loadEnv();
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not found in supabase/functions/.env');
  mkdirSync(OUT, { recursive: true });

  const results = [];
  for (const id of RECORDINGS) {
    const r = await evaluateRecording(env, id);
    results.push(r);
    console.log(
      `${r.title}: semantic recall ${pct(r.semantic.result.recall)} ` +
        `(${r.semantic.result.covered}/${r.semantic.result.total} covered), ` +
        `faithfulness ${pct(r.factual.result.faithfulness)} ` +
        `(${r.factual.result.supported}/${r.factual.result.total} supported), ` +
        `quote grounding ${pct(r.deterministic.quote_grounding.grounded_pct)}`,
    );
  }

  writeFileSync(join(OUT, 'quality-report.json'), JSON.stringify(results, null, 2));

  const md = ['# Detailed Notes — Semantic Quality Evaluation', ''];
  for (const r of results) {
    md.push(`## ${r.title}`, '');
    md.push('### Semantic completeness (recall)');
    md.push(`- **${pct(r.semantic.result.recall)}** — ${r.semantic.result.covered} covered, ${r.semantic.result.partial} partial, ${r.semantic.result.not_covered} not covered (of ${r.semantic.result.total} transcript points).`);
    md.push('');
    md.push('### Factual faithfulness');
    md.push(`- **${pct(r.factual.result.faithfulness)}** — ${r.factual.result.supported} supported, ${r.factual.result.partially_supported} partially supported, ${r.factual.result.unsupported} unsupported (of ${r.factual.result.total} note claims).`);
    md.push('');
    md.push('### Evidence verification (deterministic quote grounding)');
    md.push(`- ${r.deterministic.quote_grounding.grounded}/${r.deterministic.quote_grounding.total_quotes} section quotes grounded verbatim in the transcript (${pct(r.deterministic.quote_grounding.grounded_pct)}).`);
    if (r.deterministic.quote_grounding.drift_ms_mean !== null) {
      md.push(`- Timestamp drift: mean ${Math.round(r.deterministic.quote_grounding.drift_ms_mean)}ms, max ${Math.round(r.deterministic.quote_grounding.drift_ms_max!)}ms.`);
    }
    if (r.deterministic.quote_grounding.ungrounded_headings.length) {
      md.push(`- Ungrounded quotes (human review): ${r.deterministic.quote_grounding.ungrounded_headings.join('; ')}`);
    }
    md.push('');
    md.push('<details><summary>Transcript coverage points (for review)</summary>', '');
    for (const p of r.semantic.points) {
      const v = (r.semantic.judgments ?? []).find((j: any) => j.point_id === p.id)?.verdict ?? '?';
      md.push(`- [${v}] ${p.statement}`);
    }
    md.push('</details>', '');
    md.push('<details><summary>Note claims and verdicts (for review)</summary>', '');
    for (const j of r.factual.judgments) {
      md.push(`- [${j.verdict}] ${j.claim.statement}${j.note ? ` — ${j.note}` : ''}`);
    }
    md.push('</details>', '');
  }
  md.push(
    '',
    '_Semantic completeness (recall) and factual faithfulness are the PRIMARY quality metrics — they measure meaning, not keyword overlap. ' +
      'Both use an LLM judge on transcript-grounded extractions, and every point/claim is listed for human review. ' +
      'Quote grounding is a deterministic lower bound on faithfulness (verbatim excerpt + timestamp verification on the detailed sections). ' +
      'Coverage points and note claims are each capped at 60, so recall/faithfulness are computed over the top salient extractions, not an exhaustive enumeration. ' +
      'These are evaluation results on the two reviewed samples, not a per-recording guarantee; the engine and evaluator are both recording-agnostic._',
  );
  writeFileSync(join(OUT, 'quality-report.md'), md.join('\n'));
  console.log('Wrote', join(OUT, 'quality-report.json'), 'and', join(OUT, 'quality-report.md'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});