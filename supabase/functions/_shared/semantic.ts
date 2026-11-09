// Semantic quality evaluation: meaning-based completeness and factual faithfulness
// using transcript-grounded extraction and an LLM judge. Pure data + scoring — the
// caller supplies the model answers (so this stays testable and provider-agnostic).

export type CoverageVerdict = 'covered' | 'partial' | 'not_covered';
export type FaithfulnessVerdict = 'supported' | 'partially_supported' | 'unsupported';

export const MAX_COVERAGE_POINTS = 60;
export const MAX_CLAIMS = 60;

// ---- structured-output schemas (JSON the model must return) ----

export const POINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Stable id, e.g. "p1".' },
          statement: { type: 'string', description: 'One self-contained substantive point.' },
        },
        required: ['id', 'statement'],
      },
    },
  },
  required: ['points'],
} as const;

export const COVERAGE_JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    judgments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          point_id: { type: 'string' },
          verdict: { type: 'string', enum: ['covered', 'partial', 'not_covered'] },
          note: { type: 'string', description: 'Which note heading covers this, or why it is missing.' },
        },
        required: ['point_id', 'verdict', 'note'],
      },
    },
  },
  required: ['judgments'],
} as const;

export const CLAIM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Stable id, e.g. "c1".' },
          statement: { type: 'string', description: 'One factual claim the notes assert.' },
        },
        required: ['id', 'statement'],
      },
    },
  },
  required: ['claims'],
} as const;

export const FAITHFULNESS_JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    judgments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          claim_id: { type: 'string' },
          verdict: { type: 'string', enum: ['supported', 'partially_supported', 'unsupported'] },
          note: { type: 'string', description: 'The transcript evidence, or what the notes added that the transcript does not say.' },
        },
        required: ['claim_id', 'verdict', 'note'],
      },
    },
  },
  required: ['judgments'],
} as const;

// ---- prompts ----

export function coverageExtractionPrompt(transcript: string) {
  return {
    system:
      'You are a meticulous analyst. You extract the complete substantive content of a recording so it can be checked against a set of notes. ' +
      'Write every point as ONE self-contained, atomic statement: a topic plus its key explanation, a named fact (person, date, number, definition), ' +
      'an argument with its reasoning, a question raised, a conclusion, or a recommendation. Split compound ideas into separate points. ' +
      'Do not omit any point that carries meaning. Do not editorialize.',
    user:
      `Extract every distinct substantive point a reader would need to understand this recording without hearing it.\n` +
      `Return at most ${MAX_COVERAGE_POINTS} points.\n\n<transcript>\n${transcript}\n</transcript>`,
  };
}

export function coverageJudgmentPrompt(points: { id: string; statement: string }[], notesText: string) {
  const list = points.map((p) => `${p.id}. ${p.statement}`).join('\n');
  return {
    system:
      'You are a careful evaluator. You decide whether generated notes preserve the MEANING of each extracted point, not whether they reuse its wording. ' +
      'covered = the notes clearly convey this point. partial = the notes touch it but lose substantive detail. not_covered = the notes omit it. ' +
      'Be strict: a point is only covered if a reader of the notes alone would understand that meaning.',
    user:
      `For every point, return one judgment.\n\n<points>\n${list}\n</points>\n\n<notes>\n${notesText}\n</notes>`,
  };
}

export function claimExtractionPrompt(notesText: string) {
  return {
    system:
      'You are a meticulous analyst. You extract the factual content a set of notes asserts, so each assertion can be checked against its source transcript. ' +
      'Write each claim as ONE self-contained factual statement. Include any names, numbers, dates, causal or comparative claims, and attributed assertions. ' +
      'Split multi-fact sentences. Skip purely structural sentences like "The speaker discusses X".',
    user:
      `Extract the factual claims these notes assert.\nReturn at most ${MAX_CLAIMS} claims.\n\n<notes>\n${notesText}\n</notes>`,
  };
}

export function faithfulnessJudgmentPrompt(claims: { id: string; statement: string }[], transcript: string) {
  const list = claims.map((c) => `${c.id}. ${c.statement}`).join('\n');
  return {
    system:
      'You are a careful fact-checker. You decide whether each note claim is supported by the source transcript. ' +
      'supported = the transcript clearly states this. partially_supported = the transcript states part of it, or states something resembling it but the notes add detail the transcript does not say. ' +
      'unsupported = the notes invented, mis-attributed, or contradicted it. Base the verdict only on what the transcript says.',
    user:
      `For every claim, return one judgment.\n\n<claims>\n${list}\n</claims>\n\n<transcript>\n${transcript}\n</transcript>`,
  };
}

// ---- scoring ----

export type CoverageResult = {
  covered: number;
  partial: number;
  not_covered: number;
  total: number;
  recall: number; // (covered + 0.5*partial) / total, 0..1
};

export function semanticRecall(judgments: { verdict: CoverageVerdict }[]): CoverageResult {
  const covered = judgments.filter((j) => j.verdict === 'covered').length;
  const partial = judgments.filter((j) => j.verdict === 'partial').length;
  const not = judgments.filter((j) => j.verdict === 'not_covered').length;
  const total = judgments.length;
  return {
    covered,
    partial,
    not_covered: not,
    total,
    recall: total ? (covered + 0.5 * partial) / total : 1,
  };
}

export type FaithfulnessResult = {
  supported: number;
  partially_supported: number;
  unsupported: number;
  total: number;
  faithfulness: number; // (supported + 0.5*partially_supported) / total, 0..1
};

export function factualFaithfulness(judgments: { verdict: FaithfulnessVerdict }[]): FaithfulnessResult {
  const supported = judgments.filter((j) => j.verdict === 'supported').length;
  const partial = judgments.filter((j) => j.verdict === 'partially_supported').length;
  const not = judgments.filter((j) => j.verdict === 'unsupported').length;
  const total = judgments.length;
  return {
    supported,
    partially_supported: partial,
    unsupported: not,
    total,
    faithfulness: total ? (supported + 0.5 * partial) / total : 1,
  };
}

/** Split an over-long transcript into chunks so point/faithfulness extraction does
 * not silently drop the middle. Returns [text] when it already fits. */
export function splitForJudgement(text: string, maxChars = 30_000): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > start + Math.floor(maxChars / 2)) end = nl;
    }
    chunks.push(text.slice(start, end).trimEnd());
    if (end >= text.length) break;
    start = end;
  }
  return chunks;
}