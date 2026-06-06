import { createClient } from "@supabase/supabase-js";

// Supabase project URL + public anon key.
// The anon key is a publishable client key (protected by Row-Level Security),
// so it is safe to ship in the browser bundle. Hardcoded here so the client
// always initializes instantly, independent of build-time env injection.
const supabaseUrl = "https://ftfizfcrxgochuthofnd.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0Zml6ZmNyeGdvY2h1dGhvZm5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTg4ODYsImV4cCI6MjA5NjMzNDg4Nn0.jgYetV7ueqE6TSQjnwswT1Lq0j5C6dijMcmL3MugrOs";

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
