// Joining a recording's 5-minute parts into one transcript. Pure; tested.
import type { Utterance } from './verify.ts';

export type ChannelUtterance = { start_ms: number; end_ms: number; speaker: number; channel?: number; text: string };

/**
 * Two-channel desktop recordings: channel 0 is the computer's own microphone (one person: the
 * recorder), channel 1 is everyone else on the call. Channel 0 becomes speaker 0; the people on
 * channel 1 become speakers 1, 2, … as Deepgram told them apart. Sorted by time.
 */
export function mergeChannels(utts: ChannelUtterance[]): Utterance[] {
  return utts
    .map((u) => ({ start_ms: u.start_ms, end_ms: u.end_ms, speaker: (u.channel ?? 0) === 0 ? 0 : 1 + (u.speaker ?? 0), text: u.text }))
    .sort((a, b) => a.start_ms - b.start_ms || a.speaker - b.speaker);
}

/** The text around a join between two parts, labelled by each part's own speaker numbers. */
export function boundaryExcerpt(prev: Utterance[], next: Utterance[], windowMs = 150_000, maxChars = 6000): { before: string; after: string } {
  const prevEnd = Math.max(0, ...prev.map((u) => u.end_ms));
  const before = prev.filter((u) => u.end_ms >= prevEnd - windowMs).map((u) => `[A${u.speaker}] ${u.text}`).join('\n');
  const nextStart = Math.min(Infinity, ...next.map((u) => u.start_ms));
  const after = next.filter((u) => u.start_ms <= nextStart + windowMs).map((u) => `[B${u.speaker}] ${u.text}`).join('\n');
  return { before: before.slice(-maxChars), after: after.slice(0, maxChars) };
}

/** Speakers per part, as a sorted list of their local numbers. */
export function speakersIn(utts: Utterance[]): number[] {
  return [...new Set(utts.map((u) => u.speaker))].sort((a, b) => a - b);
}

/**
 * Give speakers one numbering across the whole recording. `maps[i]` says, for part i+1, which
 * local speaker is which speaker of part i (or null for someone new). Invalid or duplicate
 * matches are ignored — a wrong merge is worse than an extra "Speaker 4".
 */
export function joinParts(parts: Utterance[][], maps: Record<number, number | null>[]): Utterance[][] {
  if (!parts.length) return [];
  const out: Utterance[][] = [parts[0].map((u) => ({ ...u }))];
  let prevGlobal = new Map<number, number>(speakersIn(parts[0]).map((s) => [s, s]));
  let next = Math.max(-1, ...speakersIn(parts[0])) + 1;
  for (let i = 1; i < parts.length; i++) {
    const local = speakersIn(parts[i]);
    const map = maps[i - 1] ?? {};
    const used = new Set<number>();
    const global = new Map<number, number>();
    for (const s of local) {
      const prevLocal = map[s];
      const g = prevLocal != null ? prevGlobal.get(prevLocal) : undefined;
      if (g != null && !used.has(g)) {
        global.set(s, g);
        used.add(g);
      }
    }
    for (const s of local) if (!global.has(s)) global.set(s, next++);
    out.push(parts[i].map((u) => ({ ...u, speaker: global.get(u.speaker)! })));
    prevGlobal = global;
  }
  return out;
}

/** Parse the model's answer ("B0=A1, B1=new") into a map; anything unexpected is dropped. */
export function parseSpeakerMap(pairs: { b: number; a: number | null }[] | undefined, bSpeakers: number[], aSpeakers: number[]): Record<number, number | null> {
  const map: Record<number, number | null> = {};
  const taken = new Set<number>();
  for (const p of pairs ?? []) {
    if (!bSpeakers.includes(p.b) || p.b in map) continue;
    if (p.a == null || !aSpeakers.includes(p.a) || taken.has(p.a)) {
      map[p.b] = null;
      continue;
    }
    map[p.b] = p.a;
    taken.add(p.a);
  }
  return map;
}

/** Same settings → the cached transcript of a part can be reused (resuming a long recording). */
export function sttCacheKey(o: { keyterms: string[]; language: string | null; redact: string[]; multichannel: boolean; model: string }): string {
  return JSON.stringify([o.model, o.language ?? '', [...o.redact].sort(), o.multichannel, [...o.keyterms].sort()]);
}

/** Run `fn` over items with at most `limit` at once, keeping order. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
