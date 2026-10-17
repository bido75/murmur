// Expo push request building. Pure; tested.
export type PushMessage = { title: string; body: string; data?: Record<string, string> };

/** Expo push request bodies, at most 100 per request. Pure; tested. */
export function pushBatches(tokens: string[], m: PushMessage): { to: string; title: string; body: string; data?: Record<string, string>; sound: 'default' }[][] {
  const valid = [...new Set(tokens)].filter((t) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(t));
  const msgs = valid.map((to) => ({ to, title: m.title.slice(0, 120), body: m.body.slice(0, 240), data: m.data, sound: 'default' as const }));
  const out = [];
  for (let i = 0; i < msgs.length; i += 100) out.push(msgs.slice(i, i + 100));
  return out;
}

