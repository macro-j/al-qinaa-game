import { createClient } from "@supabase/supabase-js";
import { FREE_GAME_LIMIT } from "@workspace/qinaa-rules";
import type { Database } from "../supabase";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Add them to the project root .env (al-qinaa-game/.env, NOT artifacts/qinaa/.env) " +
      "and restart the Vite dev server.",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      apikey: supabaseAnonKey,
    },
  },
});

export type Entitlements = {
  games_played: number;
  has_base_game: boolean;
  has_all_access: boolean;
  /** A-la-carte items the user owns (e.g. role_wizard, role_twins, …). */
  owned_items: string[];
};

export { FREE_GAME_LIMIT };

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.error("refreshSession failed:", error);
        return null;
      }
      return data.session?.access_token ?? null;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Returns a fresh access token, refreshing the Supabase session when stale. */
export async function getValidAccessToken(options?: {
  forceRefresh?: boolean;
}): Promise<string | null> {
  if (options?.forceRefresh) return refreshAccessToken();

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) {
    console.error("getSession failed:", sessionError);
    return null;
  }

  const session = sessionData.session;
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  const needsRefresh = expiresAt <= now + 60;

  if (!needsRefresh) return session.access_token;

  return refreshAccessToken();
}
