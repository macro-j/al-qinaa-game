import { createClient } from "@supabase/supabase-js";
import type { Database } from "../supabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Add them to the project root .env file.",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type Entitlements = {
  games_played: number;
  has_base_game: boolean;
  has_all_access: boolean;
  /** A-la-carte items the user owns (e.g. role_wizard, role_twins, …). */
  owned_items: string[];
};

export const FREE_GAME_LIMIT = 2;

/** Returns a fresh access token, refreshing the Supabase session when stale. */
export async function getValidAccessToken(): Promise<string | null> {
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

  const { data: refreshed, error: refreshError } =
    await supabase.auth.refreshSession();
  if (refreshError) {
    console.error("refreshSession failed:", refreshError);
    return null;
  }

  return refreshed.session?.access_token ?? null;
}
