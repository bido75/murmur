import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { Bridge } from "../shared/bridge";

declare const window: Window & { murmur: Bridge };

/**
 * Session tokens live in the main process's OS-protected store, not in this page's
 * localStorage: the refresh token must never sit in a plain-text file. The adapter
 * speaks the storage shape supabase-js expects; the values are handled by the main
 * process with the operating system's own key store.
 */
const secureStorage = {
  getItem: async (key: string) => window.murmur.secureGet(key),
  setItem: async (key: string, value: string) => {
    await window.murmur.secureSet(key, value);
  },
  removeItem: async (key: string) => {
    await window.murmur.secureRemove(key);
  },
};

export const supabase = createClient(
  SUPABASE_URL || "https://missing.supabase.co",
  SUPABASE_ANON_KEY || "missing",
  {
    auth: {
      storage: secureStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
