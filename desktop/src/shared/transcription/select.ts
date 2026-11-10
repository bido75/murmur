// Which transcription engine may handle a job.
//
// The Local Only promise is checked here as well as in each provider: when the user
// asked for local-only privacy, a cloud engine is refused with a reason, never
// silently swapped for, or fallen back to, anything that phones home.

import type {
  ProviderType,
  TranscriptionOptions,
  TranscriptionProvider,
} from "./interfaces";

/** Providers that send audio off the machine. Parakeet and Whisper read audio locally. */
const CLOUD_TYPES: ProviderType[] = ["deepgram"];

export function isCloudProvider(p: TranscriptionProvider): boolean {
  return CLOUD_TYPES.includes(p.type);
}

export type Selection =
  | { ok: true; provider: TranscriptionProvider }
  | { ok: false; reason: "local-only-refused"; providerType: ProviderType }
  | { ok: false; reason: "none-available"; wanted: ProviderType | "any" };

/**
 * Pick the provider for one job.
 *
 * `privacy: "local-only"` is decisive: a cloud provider is refused even if it is the
 * only one present, and the refusal is a value the caller must show, not an exception
 * to swallow. Without a preference, a provider both available and willing to take the
 * job wins.
 */
export async function pickProvider(
  providers: TranscriptionProvider[],
  options: TranscriptionOptions = {},
): Promise<Selection> {
  const localOnly = options.privacy === "local-only";
  for (const p of providers) {
    if (localOnly && isCloudProvider(p))
      return { ok: false, reason: "local-only-refused", providerType: p.type };
    if (await p.isAvailable()) {
      if (!p.canTranscribe(options)) continue;
      return { ok: true, provider: p };
    }
  }
  if (localOnly)
    // No provider was even reachable that respects the mode: say so plainly.
    return { ok: false, reason: "none-available", wanted: "any" };
  return { ok: false, reason: "none-available", wanted: "any" };
}
