import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase config missing: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
};

export const FREE_GAME_LIMIT = 2;
