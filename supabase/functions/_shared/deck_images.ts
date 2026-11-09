// Provider-independent image generation for decks. The pure pieces (config resolution,
// prompt construction, request shaping, budgeting) are unit-testable; the network call
// lives in the make-deck edge function. OpenRouter and OpenAI are both supported, and
// a deck gracefully falls back to an editable text placeholder when neither key exists.
//
// Generated imagery is "illustrative" (clearly labelled): it must never be mistaken for
// a photograph of a real site, product, result or completed work.

export type ImageSpec = {
  description: string;
  style: string;
  illustrative: boolean;
};

export type ImageProviderConfig = {
  name: 'openrouter' | 'openai';
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Resolve the image provider from an env record. `IMAGE_API_KEY` selects OpenAI; if it
 * is absent but `OPENROUTER_API_KEY` is present, OpenRouter is used with that same key
 * (so no second key is needed). Returns null when no key is configured.
 */
export function imageProviderConfig(env: Record<string, string | undefined>): ImageProviderConfig | null {
  const explicitKey = env['IMAGE_API_KEY'];
  const openrouterKey = env['OPENROUTER_API_KEY'];
  const provider = (env['IMAGE_PROVIDER'] ?? (explicitKey ? 'openai' : openrouterKey ? 'openrouter' : '')).toLowerCase();
  const apiKey = explicitKey ?? (provider === 'openrouter' ? openrouterKey : undefined);
  if (!apiKey) return null;
  if (provider === 'openrouter') {
    return {
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey,
      model: env['IMAGE_MODEL'] ?? 'openai/gpt-image-1',
    };
  }
  return {
    name: 'openai',
    baseUrl: (env['IMAGE_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey,
    model: env['IMAGE_MODEL'] ?? 'gpt-image-1',
  };
}

/** A 16:9, text-free, style-following generation prompt. No words/labels/logos, so the
 * editable PowerPoint text stays the source of truth and never overlaps baked-in text. */
export function imagePrompt(spec: ImageSpec): string {
  const parts = [
    'Wide 16:9 landscape illustration for a professional presentation, no borders or frames.',
    'No text, no words, no letters, no numbers, no labels, no captions, no logos, no watermarks.',
    'Clean, modern, high-quality, well-composed, appropriate for business use.',
    spec.style ? `Visual style: ${spec.style}.` : '',
    `Depict: ${spec.description}`,
  ];
  if (spec.illustrative) parts.push('This is a conceptual illustration, not a photo of a real place or product.');
  return parts.filter(Boolean).join(' ');
}

export const DEFAULT_IMAGE_BUDGET = 4;

/** Clamp how many images are generated for a deck to the configured budget. */
export function imageBudget(requested: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.max(0, Math.min(Math.max(0, requested), budget));
}

/**
 * The fetch target and body for the configured provider. OpenRouter uses its dedicated
 * `/images` endpoint with `aspect_ratio`; OpenAI uses `/images/generations` with `size`.
 */
export function imageRequest(cfg: ImageProviderConfig, spec: ImageSpec): { url: string; body: Record<string, unknown> } {
  const prompt = imagePrompt(spec);
  if (cfg.name === 'openrouter') {
    return {
      url: `${cfg.baseUrl}/images`,
      body: { model: cfg.model, prompt, n: 1, aspect_ratio: '16:9', quality: 'high' },
    };
  }
  return {
    url: `${cfg.baseUrl}/images/generations`,
    body: { model: cfg.model, prompt, n: 1, size: '1792x1024', response_format: 'b64_json' },
  };
}