// Pure logic shared by the edge functions. No Deno or Node APIs here, so it can be
// unit-tested with `npm test`.

export type Utterance = {
  start_ms: number;
  end_ms: number;
  speaker: number;
  text: string;
};

export type RawActionItem = {
  task: string;
  owner?: string | null;
  owner_basis?: 'named' | 'self_assigned' | 'unassigned';
  due?: string | null;
  kind?: 'commitment' | 'suggestion';
  quote?: string | null;
};

export type VerifiedActionItem = {
  text: string;
  owner: string | null;
  owner_basis: 'named' | 'self_assigned' | 'unassigned';
  due_text: string | null;
  kind: 'commitment' | 'suggestion';
  quote: string | null;
  quote_ms: number | null;
  verified: boolean;
  needs_review: boolean;
};

export type QuoteMatch = { found: boolean; start_ms: number | null };

export type RawKeyPoint = { text: string; quote?: string | null } | string;

export type VerifiedKeyPoint = {
  text: string;
  quote: string | null;
  quote_ms: number | null;
  verified: boolean;
};

/** Lowercase, expand contractions, drop punctuation, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bcannot\b/g, 'can not')
    .replace(/n't\b/g, ' not')
    .replace(/'ll\b/g, ' will')
    .replace(/'re\b/g, ' are')
    .replace(/'ve\b/g, ' have')
    .replace(/\bi'm\b/g, 'i am')
    .replace(/'d\b/g, ' would')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(
  'a an the and or but so to of in on at for by with it its is are was were be been i you he she we they me us them my your our their this that these those there here do does did will would can could should not no yes ok okay um uh just'.split(' '),
);

function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Format a transcript for the model: one numbered line per utterance. */
export function formatTranscript(utterances: Utterance[], speakerNames: Record<string, string> = {}): string {
  return utterances
    .map((u) => `[${formatClock(u.start_ms)}] ${speakerLabel(u.speaker, speakerNames)}: ${u.text}`)
    .join('\n');
}

export function speakerLabel(speaker: number, names: Record<string, string> = {}): string {
  return names[String(speaker)] ?? `Speaker ${speaker + 1}`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Find a quote in the transcript. Exact match on normalized text first; otherwise a
 * fuzzy match where at least 80% of the quote's words appear, in order-insensitive
 * fashion, inside a window of one to three consecutive utterances.
 */
export function findQuote(quote: string | null | undefined, utterances: Utterance[]): QuoteMatch {
  const q = normalize(quote ?? '');
  if (!q || q.split(' ').length < 2) return { found: false, start_ms: null };

  // Exact, allowing the quote to span up to three consecutive utterances. The match
  // must begin inside utterance i, so the timestamp points where the words start.
  const norm = utterances.map((u) => normalize(u.text));
  for (let i = 0; i < utterances.length; i++) {
    const joined = norm.slice(i, i + 3).join(' ');
    const at = joined.indexOf(q);
    if (at >= 0 && at < norm[i].length) return { found: true, start_ms: utterances[i].start_ms };
  }

  // Fuzzy: word overlap.
  const qTokens = tokens(q);
  let best = { score: 0, start_ms: null as number | null };
  for (let i = 0; i < utterances.length; i++) {
    const window = new Map<string, number>();
    for (let w = 0; w < 3 && i + w < utterances.length; w++) {
      for (const t of tokens(utterances[i + w].text)) window.set(t, (window.get(t) ?? 0) + 1);
    }
    let hits = 0;
    const used = new Map<string, number>();
    for (const t of qTokens) {
      const have = window.get(t) ?? 0;
      const u = used.get(t) ?? 0;
      if (u < have) {
        hits++;
        used.set(t, u + 1);
      }
    }
    const score = hits / qTokens.length;
    // Only credit a window whose first utterance shares a meaningful word with the
    // quote; otherwise the window really starts later.
    const content = qTokens.filter((t) => !STOPWORDS.has(t));
    const firstShares = tokens(utterances[i].text).some((t) => content.includes(t));
    if (score > best.score && firstShares) best = { score, start_ms: utterances[i].start_ms };
  }
  return best.score >= 0.8 ? { found: true, start_ms: best.start_ms } : { found: false, start_ms: null };
}

/** True if the owner's name (or its first word) is said in the transcript. */
export function ownerMentioned(owner: string, transcriptText: string, speakerNames: Record<string, string> = {}): boolean {
  const o = normalize(owner);
  if (!o) return false;
  if (Object.values(speakerNames).some((n) => normalize(n) === o)) return true;
  const text = ' ' + normalize(transcriptText) + ' ';
  if (text.includes(' ' + o + ' ')) return true;
  const first = o.split(' ')[0];
  return first.length >= 2 && text.includes(' ' + first + ' ');
}

/**
 * Turn the model's raw action items into trustworthy tasks:
 * - a task whose quote is not in the transcript is kept but flagged unverified + needs_review
 * - an owner the transcript never names is dropped (unassigned) and flagged
 * - suggestions ("we could...") are flagged for review instead of becoming tasks silently
 * - empty and duplicate tasks are removed
 */
export function verifyActionItems(
  items: RawActionItem[],
  utterances: Utterance[],
  speakerNames: Record<string, string> = {},
): VerifiedActionItem[] {
  const transcriptText = utterances.map((u) => u.text).join(' ');
  const seen = new Set<string>();
  const out: VerifiedActionItem[] = [];

  for (const item of items ?? []) {
    const text = (item.task ?? '').trim();
    if (!text) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);

    const match = findQuote(item.quote, utterances);
    const kind = item.kind === 'suggestion' ? 'suggestion' : 'commitment';
    let owner = item.owner?.trim() || null;
    let owner_basis = item.owner_basis ?? (owner ? 'named' : 'unassigned');
    let ownerProblem = false;

    if (owner_basis === 'unassigned') owner = null;
    if (owner && owner_basis === 'named' && !ownerMentioned(owner, transcriptText, speakerNames)) {
      owner = null;
      owner_basis = 'unassigned';
      ownerProblem = true;
    }
    if (!owner && owner_basis !== 'unassigned') owner_basis = 'unassigned';

    out.push({
      text,
      owner,
      owner_basis,
      due_text: item.due?.trim() || null,
      kind,
      quote: item.quote?.trim() || null,
      quote_ms: match.start_ms,
      verified: match.found,
      needs_review: !match.found || ownerProblem || kind === 'suggestion',
    });
  }
  return out;
}

/** Shift segment-relative utterances onto the recording's timeline. */
export function offsetUtterances(utterances: Utterance[], offsetMs: number): Utterance[] {
  return utterances.map((u) => ({ ...u, start_ms: u.start_ms + offsetMs, end_ms: u.end_ms + offsetMs }));
}

/**
 * Check each key point against the transcript. A key point only gets a time when the
 * quote it was written from is really in the transcript, so a chip always points at the
 * moment that was said. Key points without a quote are kept, but they get no chip.
 */
export function verifyKeyPoints(items: RawKeyPoint[], utterances: Utterance[]): VerifiedKeyPoint[] {
  const seen = new Set<string>();
  const out: VerifiedKeyPoint[] = [];
  for (const item of items ?? []) {
    const raw = typeof item === 'string' ? { text: item, quote: null } : item;
    const text = (raw?.text ?? '').trim();
    if (!text) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const m = findQuote(raw.quote, utterances);
    out.push({ text, quote: raw.quote?.trim() || null, quote_ms: m.start_ms, verified: m.found });
  }
  return out;
}

// ---------- Carry-over: earlier tasks discussed in a later recording ----------

export type OpenTaskRef = { ref: string; id: string; text: string };
export type RawTaskUpdate = { ref: string; status: 'done' | 'in_progress' | 'blocked'; note?: string | null; quote?: string | null };
export type VerifiedTaskUpdate = {
  task_id: string;
  text: string;
  status: 'done' | 'in_progress' | 'blocked';
  note: string | null;
  quote: string | null;
  quote_ms: number | null;
  verified: boolean;
};

/** Short refs (T1, T2...) are easier for the model to copy than UUIDs. */
export function makeRefs(tasks: { id: string; text: string }[]): OpenTaskRef[] {
  return tasks.map((t, i) => ({ ref: `T${i + 1}`, id: t.id, text: t.text }));
}

/**
 * Keep only updates that point at a real open task, once each, and check the quote.
 * Only a verified "done" may close a task; everything else is informational.
 */
export function verifyTaskUpdates(updates: RawTaskUpdate[], refs: OpenTaskRef[], utterances: Utterance[]): VerifiedTaskUpdate[] {
  const byRef = new Map(refs.map((r) => [r.ref.toUpperCase(), r]));
  const seen = new Set<string>();
  const out: VerifiedTaskUpdate[] = [];
  for (const u of updates ?? []) {
    const r = byRef.get(String(u.ref ?? '').trim().toUpperCase());
    if (!r || seen.has(r.id)) continue;
    if (!['done', 'in_progress', 'blocked'].includes(u.status)) continue;
    seen.add(r.id);
    const m = findQuote(u.quote, utterances);
    out.push({
      task_id: r.id,
      text: r.text,
      status: u.status,
      note: u.note?.trim() || null,
      quote: u.quote?.trim() || null,
      quote_ms: m.start_ms,
      verified: m.found,
    });
  }
  return out;
}

function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a).filter((t) => !STOPWORDS.has(t)));
  const B = new Set(tokens(b).filter((t) => !STOPWORDS.has(t)));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Drop new action items that just repeat a task that is already open. */
export function dropRepeats<T extends { text: string }>(items: T[], openTexts: string[]): T[] {
  return items.filter((it) => !openTexts.some((o) => normalize(o) === normalize(it.text) || jaccard(o, it.text) >= 0.75));
}
