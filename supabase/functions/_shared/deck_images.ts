// Provider-independent image generation for decks. The pure pieces (config
// resolution, prompt construction, budgeting) are unit-testable; the actual network
// call lives in the make-deck edge function so the service stays provider-agnostic and
// gracefully a no-op when no key is configured.
//
// Generated imagery is always "illustrative" (clearly labelled): it must never be
// mistaken for a photograph of a real site, product, result or completed work.

export type ImageSpec = {
  description: string;
  style: string;
  illustrative: boolean;
};

export type GeneratedImage = {
  dataUri: string;
  width: number;
  height: number;
  illustrative: boolean;
  prompt: string;
  provider: string;
};

export type ImageProviderConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** Resolve an OpenAI-compatible image provider from an env record, or null when none
 * is configured (in which case decks fall back to text-only visuals). */
export function imageProviderConfig(env: Record<string, string | undefined>): ImageProviderConfig | null {
  const apiKey = env['IMAGE_API_KEY'];
  if (!apiKey) return null;
  return {
    name: env['IMAGE_PROVIDER'] ?? 'openai',
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

/** Preferred wide generation size (gpt-image / DALL-E 3 landscape, ~16:9). */
export const IMAGE_SIZE = '1792x1024';

export const DEFAULT_IMAGE_BUDGET = 4;

/** Clamp how many images are generated for a deck to the configured budget. */
export function imageBudget(requested: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.max(0, Math.min(Math.max(0, requested), budget));
}