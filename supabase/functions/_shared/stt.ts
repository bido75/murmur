// Deepgram request parameters. Pure; tested.

export type SttOptions = { model?: string; keyterms?: string[]; language?: string | null; redact?: string[]; mipOptOut?: boolean; multichannel?: boolean };

const REDACT = new Set(['pii', 'phi', 'pci', 'numbers']);

/**
 * - language null/undefined: auto-detect the (single) language.
 * - 'multi': several languages in one recording (code-switching).
 * - a code like 'es' or 'pt-BR': that language.
 * Keyterms only with nova-3. Redaction groups replace personal details with tags in the transcript.
 */
export function deepgramParams(o: SttOptions, withKeyterms = true): URLSearchParams {
  const model = o.model || 'nova-3';
  const p = new URLSearchParams({ model, smart_format: 'true', punctuate: 'true', diarize: 'true', utterances: 'true' });
  const lang = o.language?.trim();
  if (!lang) p.set('detect_language', 'true');
  else if (lang === 'multi') p.set('language', 'multi');
  else if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang)) p.set('language', lang);
  else p.set('detect_language', 'true');
  for (const r of o.redact ?? []) if (REDACT.has(r)) p.append('redact', r);
  if (o.mipOptOut !== false) p.set('mip_opt_out', 'true');
  // Desktop recordings: your mic on one channel, the other people on the other.
  if (o.multichannel) p.set('multichannel', 'true');
  if (withKeyterms && model.startsWith('nova-3')) for (const k of o.keyterms ?? []) p.append('keyterm', k);
  return p;
}

/** Parameters for the live (streaming) transcript in the browser or desktop app. */
export function liveParams(o: { language?: string | null; redact?: string[] }): URLSearchParams {
  const p = new URLSearchParams({ model: 'nova-3', smart_format: 'true', interim_results: 'true', punctuate: 'true' });
  const lang = o.language?.trim();
  if (lang === 'multi') {
    p.set('language', 'multi');
    p.set('endpointing', '100');
  } else if (lang && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(lang)) p.set('language', lang);
  for (const r of o.redact ?? []) if (REDACT.has(r)) p.append('redact', r);
  p.set('mip_opt_out', 'true');
  return p;
}
