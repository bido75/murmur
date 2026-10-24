import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { resolveSupabaseUrl } from "./serverAddress";

/** The name the app was served from, when it is in a browser. */
function pageHost(): string | null {
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined") return null;
  return window.location?.hostname ?? null;
}

export const supabase = createClient(
  resolveSupabaseUrl(SUPABASE_URL || "https://missing.supabase.co", pageHost()),
  SUPABASE_ANON_KEY || "missing",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // Single sign-on returns a one-time code to /sso-callback, exchanged there (see app/sso-callback).
      flowType: "pkce",
    },
  },
);

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Keep tokens fresh only while the app is in the foreground.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
