// Injected at build time by build.mjs from ../.env (or the environment).
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;
declare const __APP_URL__: string;

export const SUPABASE_URL = __SUPABASE_URL__;
export const SUPABASE_ANON_KEY = __SUPABASE_ANON_KEY__;
export const APP_URL = __APP_URL__;
export const APP_NAME = 'Murmur';
export const SEGMENT_MS = 5 * 60 * 1000;
export const CHUNK_MS = 4000;
export const SILENCE_DB = -50;
export const SILENCE_WARN_MS = 45_000;
