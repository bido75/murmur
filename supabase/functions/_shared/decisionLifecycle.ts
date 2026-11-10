// Decision lifecycle: matching a new decision to an earlier one it revises. Pure and
// testable — a conservative token-overlap heuristic, so unrelated decisions are never
// silently linked (the spec: do not auto-resolve conflicting evidence without cause).

const STOPWORDS = new Set(
  'a an the and or but so to of in on at for by with it its we you they them this that these those will would should could not no yes is are was were be been have has had do does did'.split(' '),
);

function tokens(s: string): Set<string> {
  const n = s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return new Set(n.split(' ').filter((t) => t.length >= 2 && !STOPWORDS.has(t)));
}

/** The prior decision text a new decision supersedes, or null when none is clearly a
 * revision of it. Conservative Jaccard threshold (default 0.6): a revision keeps most
 * substantive tokens and changes a detail, while unrelated decisions share none. */
export function supersedesPrior(newText: string, priors: string[], threshold = 0.6): string | null {
  const a = tokens(newText);
  if (a.size === 0) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const p of priors) {
    const b = tokens(p);
    if (b.size === 0) continue;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const score = inter / (a.size + b.size - inter);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= threshold ? best : null;
}
