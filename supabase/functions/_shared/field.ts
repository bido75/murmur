// Field mode: the daily site log, photo linking and transcription hints. Pure, unit-tested.
import { findQuote, normalize, type Utterance } from './verify.ts';

// ---------- Words to listen for (Deepgram keyterm prompting) ----------

/** Jargon that general speech models often mishear on construction sites. */
export const SITE_TERMS = ['RFI', 'submittal', 'punch list', 'firestopping', 'CMU', 'GWB', 'MEP', 'rebar', 'formwork', 'shoring', 'egress', 'change order'];

/**
 * Terms to boost, most specific first: the project's own words, its name, people's names,
 * then site jargon for site walks. Deduplicated and capped well under Deepgram's limit of
 * 500 tokens across all terms (we budget ~4 characters per token and stop at 50 terms).
 */
export function buildKeyterms(o: { vocabulary?: string[]; projectName?: string | null; names?: string[]; template?: string }): string[] {
  const candidates = [
    ...(o.vocabulary ?? []),
    ...(o.projectName ? [o.projectName] : []),
    ...(o.names ?? []),
    ...(o.template === 'site_walk' ? SITE_TERMS : []),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const raw of candidates) {
    const term = String(raw ?? '').replace(/[\r\n\t,;]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    // Skip empties, generic placeholders like "Speaker 2", and very short words that boost noise.
    if (term.length < 2 || /^speaker \d+$/i.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    if (out.length >= 50 || chars + term.length > 1600) break;
    seen.add(key);
    out.push(term);
    chars += term.length;
  }
  return out;
}

// ---------- Daily site log ----------

export type SiteCategory = 'safety' | 'quality' | 'schedule' | 'other';

type Q = { quote: string };
export type RawSiteLog = {
  weather?: ({ text: string } & Q) | null;
  manpower?: ({ company_or_trade: string; count: number | null } & Q)[];
  work_completed?: ({ text: string; location: string | null } & Q)[];
  issues?: ({ text: string; location: string | null; category: SiteCategory } & Q)[];
  deliveries?: ({ text: string } & Q)[];
  inspections?: ({ text: string; result: string | null } & Q)[];
  delays?: ({ text: string } & Q)[];
};

/** Every entry carries proof: where it was said, and whether the quote was found. */
type Proof = { quote: string; quote_ms: number | null; verified: boolean; photo_ids: string[] };
export type SiteLog = {
  weather: ({ text: string } & Proof) | null;
  manpower: ({ company_or_trade: string; count: number | null } & Proof)[];
  work_completed: ({ text: string; location: string | null } & Proof)[];
  issues: ({ text: string; location: string | null; category: SiteCategory } & Proof)[];
  deliveries: ({ text: string } & Proof)[];
  inspections: ({ text: string; result: string | null } & Proof)[];
  delays: ({ text: string } & Proof)[];
};

export const SITE_LOG_SECTIONS = ['manpower', 'work_completed', 'issues', 'deliveries', 'inspections', 'delays'] as const;

const quoteProp = { type: 'string', description: 'Word for word from the transcript, 5 to 25 words, where this was said.' };

export const SITE_LOG_SCHEMA = {
  type: 'object',
  description: 'Daily site log. Only what was actually said; leave a list empty if nothing was said about it.',
  properties: {
    weather: {
      type: ['object', 'null'],
      properties: { text: { type: 'string', description: 'Weather or site conditions as said.' }, quote: quoteProp },
      required: ['text', 'quote'],
    },
    manpower: {
      type: 'array',
      description: 'Crews on site: company or trade, and headcount only if a number was said.',
      items: {
        type: 'object',
        properties: { company_or_trade: { type: 'string' }, count: { type: ['integer', 'null'] }, quote: quoteProp },
        required: ['company_or_trade', 'count', 'quote'],
      },
    },
    work_completed: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, location: { type: ['string', 'null'], description: 'Floor, room, grid line or area, if said.' }, quote: quoteProp },
        required: ['text', 'location', 'quote'],
      },
    },
    issues: {
      type: 'array',
      description: 'Problems and observations. Anything that could hurt someone is category "safety".',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          location: { type: ['string', 'null'] },
          category: { type: 'string', enum: ['safety', 'quality', 'schedule', 'other'] },
          quote: quoteProp,
        },
        required: ['text', 'location', 'category', 'quote'],
      },
    },
    deliveries: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, quote: quoteProp }, required: ['text', 'quote'] } },
    inspections: {
      type: 'array',
      items: { type: 'object', properties: { text: { type: 'string' }, result: { type: ['string', 'null'], description: 'Passed, failed, partial, as said.' }, quote: quoteProp }, required: ['text', 'result', 'quote'] },
    },
    delays: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, quote: quoteProp }, required: ['text', 'quote'] } },
  },
  required: ['weather', 'manpower', 'work_completed', 'issues', 'deliveries', 'inspections', 'delays'],
} as const;

export const SITE_LOG_RULES = [
  '',
  'Also fill site_log, the daily site log:',
  '- Only things said in the transcript. Never fill in typical site activity that was not mentioned.',
  '- Headcounts only when a number was said; otherwise count is null.',
  '- Every entry needs a word-for-word quote, like action items.',
  '- An issue can also be an action item if someone was asked to fix it; list it in both.',
].join('\n');

function clean(s: unknown, max = 300): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Check every entry's quote against the transcript and drop duplicates and empty entries. */
export function verifySiteLog(raw: RawSiteLog | null | undefined, utterances: Utterance[]): SiteLog {
  const proof = (quote: unknown): Proof => {
    const q = clean(quote, 400);
    const m = findQuote(q, utterances);
    return { quote: q, quote_ms: m.start_ms, verified: m.found, photo_ids: [] };
  };
  const list = <T extends Record<string, unknown>, R>(items: T[] | undefined, key: (x: T) => string, map: (x: T) => R): R[] => {
    const seen = new Set<string>();
    const out: R[] = [];
    for (const item of Array.isArray(items) ? items.slice(0, 60) : []) {
      if (!item || typeof item !== 'object') continue;
      const k = normalize(key(item));
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(map(item));
    }
    return out;
  };
  const r = raw ?? {};
  const category = (c: unknown): SiteCategory => (['safety', 'quality', 'schedule', 'other'].includes(c as string) ? (c as SiteCategory) : 'other');
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 10000 ? Math.round(n) : null);

  return {
    weather: r.weather && clean(r.weather.text) ? { text: clean(r.weather.text), ...proof(r.weather.quote) } : null,
    manpower: list(r.manpower, (x) => clean(x.company_or_trade), (x) => ({ company_or_trade: clean(x.company_or_trade, 120), count: count(x.count), ...proof(x.quote) })),
    work_completed: list(r.work_completed, (x) => clean(x.text), (x) => ({ text: clean(x.text), location: clean(x.location, 120) || null, ...proof(x.quote) })),
    issues: list(r.issues, (x) => clean(x.text), (x) => ({ text: clean(x.text), location: clean(x.location, 120) || null, category: category(x.category), ...proof(x.quote) })),
    deliveries: list(r.deliveries, (x) => clean(x.text), (x) => ({ text: clean(x.text), ...proof(x.quote) })),
    inspections: list(r.inspections, (x) => clean(x.text), (x) => ({ text: clean(x.text), result: clean(x.result, 80) || null, ...proof(x.quote) })),
    delays: list(r.delays, (x) => clean(x.text), (x) => ({ text: clean(x.text), ...proof(x.quote) })),
  };
}

export function siteLogIsEmpty(log: SiteLog | null | undefined): boolean {
  return !log || (!log.weather && SITE_LOG_SECTIONS.every((k) => log[k].length === 0));
}

// ---------- Photos ----------

export type PhotoMark = { id: string; taken_ms: number | null };

/** A photo belongs to something said up to 15 s after it was taken, or up to 45 s before. */
export const PHOTO_BEFORE_MS = 15_000; // photo taken before the words
export const PHOTO_AFTER_MS = 45_000; // photo taken after the words (you talk, then shoot)

/**
 * Link each photo to the single nearest item (by the time its quote was said) within the
 * window, so a photo never lands on an unrelated item. Items without a verified time get none.
 * Returns photo ids per item index, in the order the photos were taken.
 */
export function assignPhotos(items: { quote_ms: number | null; verified: boolean }[], photos: PhotoMark[]): string[][] {
  const out: string[][] = items.map(() => []);
  const timed = photos.filter((p) => typeof p.taken_ms === 'number').sort((a, b) => a.taken_ms! - b.taken_ms!);
  for (const p of timed) {
    let best = -1;
    let bestDist = Infinity;
    items.forEach((it, i) => {
      if (!it.verified || it.quote_ms == null) return;
      const delta = p.taken_ms! - it.quote_ms; // positive: photo after the words
      if (delta < -PHOTO_BEFORE_MS || delta > PHOTO_AFTER_MS) return;
      const dist = Math.abs(delta);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    });
    if (best >= 0) out[best].push(p.id);
  }
  return out;
}

/** Attach photos to site-log entries (issues and completed work first: that's what people photograph). */
export function attachPhotosToLog(log: SiteLog, photos: PhotoMark[]): SiteLog {
  const order = ['issues', 'work_completed', 'inspections', 'deliveries', 'delays', 'manpower'] as const;
  const flat: { quote_ms: number | null; verified: boolean; photo_ids: string[] }[] = order.flatMap((k) => log[k] as { quote_ms: number | null; verified: boolean; photo_ids: string[] }[]);
  const assigned = assignPhotos(flat, photos);
  flat.forEach((item, i) => (item.photo_ids = assigned[i]));
  return log;
}

/** Plain-text daily log, used for Procore's daily log and for sharing. Verified entries only. */
export function formatSiteLog(log: SiteLog, o: { title: string; date: string; link?: string | null }): string {
  const lines: string[] = [`${o.title} (${o.date})`];
  const ok = <T extends { verified: boolean }>(xs: T[]) => xs.filter((x) => x.verified);
  if (log.weather?.verified) lines.push('', `Weather: ${log.weather.text}`);
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push('', `${title}:`, ...items.map((s) => `- ${s}`));
  };
  const at = (loc: string | null) => (loc ? ` (${loc})` : '');
  section('Manpower', ok(log.manpower).map((m) => `${m.company_or_trade}${m.count != null ? `: ${m.count}` : ''}`));
  section('Work completed', ok(log.work_completed).map((w) => `${w.text}${at(w.location)}`));
  section('Safety', ok(log.issues).filter((i) => i.category === 'safety').map((i) => `${i.text}${at(i.location)}`));
  section('Issues', ok(log.issues).filter((i) => i.category !== 'safety').map((i) => `${i.text}${at(i.location)} [${i.category}]`));
  section('Inspections', ok(log.inspections).map((i) => `${i.text}${i.result ? `: ${i.result}` : ''}`));
  section('Deliveries', ok(log.deliveries).map((d) => d.text));
  section('Delays', ok(log.delays).map((d) => d.text));
  if (o.link) lines.push('', `Recording and transcript: ${o.link}`);
  return lines.join('\n');
}

// ---------- Photos in site reports ----------

export type PhotoRow = { id: string; recording_id: string; taken_ms: number | null; caption: string | null; width: number | null; height: number | null; storage_path: string };
export type CaptionedPhoto = PhotoRow & { title: string; detail: string | null; quote: string | null; linked: boolean };

/**
 * Choose up to `max` photos for a report and say what each shows: the site-log entry or
 * task it was linked to (by when it was taken), else the photo's own caption. Linked
 * photos (issues first) come before the rest; within a group, in the order they were taken.
 */
export function captionPhotos(
  photos: PhotoRow[],
  logs: { recording_id: string; site_log: SiteLog | null }[],
  tasks: { text: string; quote: string | null; photo_ids: string[] | null }[],
  recordingTitles: Record<string, string>,
  max = 10,
): CaptionedPhoto[] {
  const info = new Map<string, { title: string; detail: string | null; quote: string | null; rank: number }>();
  for (const { site_log } of logs) {
    if (!site_log) continue;
    for (const i of site_log.issues ?? []) {
      for (const id of i.photo_ids ?? []) {
        if (!info.has(id) && i.verified) info.set(id, { title: i.text, detail: [i.category === 'safety' ? 'Safety' : null, i.location].filter(Boolean).join(' · ') || null, quote: i.quote, rank: i.category === 'safety' ? 0 : 1 });
      }
    }
    for (const w of site_log.work_completed ?? []) {
      for (const id of w.photo_ids ?? []) if (!info.has(id) && w.verified) info.set(id, { title: w.text, detail: w.location, quote: w.quote, rank: 2 });
    }
  }
  for (const t of tasks) for (const id of t.photo_ids ?? []) if (!info.has(id)) info.set(id, { title: t.text, detail: 'Action item', quote: t.quote, rank: 3 });

  const time = (ms: number | null) => (ms == null ? null : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`);
  return photos
    .map((p) => {
      const linked = info.get(p.id);
      const at = time(p.taken_ms);
      const fallbackDetail = [recordingTitles[p.recording_id], at ? `at ${at}` : null].filter(Boolean).join(' · ') || null;
      return {
        ...p,
        title: linked?.title ?? (p.caption?.trim() || 'Site photo'),
        detail: linked ? linked.detail ?? fallbackDetail : fallbackDetail,
        quote: linked?.quote ?? null,
        linked: Boolean(linked),
        _rank: linked?.rank ?? 9,
      };
    })
    .sort((a, b) => a._rank - b._rank || (a.taken_ms ?? Infinity) - (b.taken_ms ?? Infinity))
    .slice(0, max)
    .map(({ _rank, ...rest }) => rest);
}
