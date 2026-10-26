// Rename the product here. Nothing else in the app hard-codes the name.
export const APP_NAME = "Murmur";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** Where the web app is hosted, e.g. https://app.example.com. Needed for AI-connector sign-in. */
export const APP_URL = (process.env.EXPO_PUBLIC_APP_URL ?? "").replace(
  /\/$/,
  "",
);

/** Audio is split into files of this length so a crash can lose at most one segment. */
export const SEGMENT_MS = 5 * 60 * 1000;
/** Warn when the mic hears near-silence for this long. */
export const SILENCE_WARN_MS = 60 * 1000;
/**
 * dBFS below which we treat input as silence. Quiet-but-really-speaking often dips
 * to about -45 dBFS, so the bar for "genuinely nothing" is set a little below that;
 * an overly eager threshold is what produced false "check the mic" warnings.
 */
export const SILENCE_DB = -55;
