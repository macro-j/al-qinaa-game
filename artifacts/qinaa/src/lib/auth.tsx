import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, FREE_GAME_LIMIT, type Entitlements } from "./supabase";

const DEFAULT_ENTITLEMENTS: Entitlements = {
  games_played: 0,
  has_base_game: false,
  has_all_access: false,
};

const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL ?? "/"}`;

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  entitlements: Entitlements | null;
  loading: boolean;
  /** true while the entitlements row is being fetched/created */
  entitlementsLoading: boolean;
  /** can the user start another game right now? */
  canStartGame: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  incrementGamesPlayed: () => Promise<void>;
  refreshEntitlements: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);

  // Tracks which user id we've already provisioned a row for, to avoid
  // redundant select/insert round-trips on every auth event.
  const provisionedFor = useRef<string | null>(null);
  // The uid whose entitlements are currently authoritative. Async fetches
  // compare against this so a response for a signed-out / switched account
  // can never overwrite the current user's state (stale-response guard).
  const activeUidRef = useRef<string | null>(null);

  // ── Fetch-or-create the user's entitlements row ──
  // Fail-closed: on any error we leave entitlements `null` (locked) rather
  // than granting a fresh trial, so a backend failure can't unlock play.
  const loadEntitlements = async (uid: string) => {
    setEntitlementsLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_entitlements")
        .select("games_played, has_base_game, has_all_access")
        .eq("user_id", uid)
        .maybeSingle();

      if (activeUidRef.current !== uid) return; // stale: user changed mid-flight

      if (error) {
        console.error("[auth] failed to load entitlements:", error.message);
        setEntitlements(null);
        return;
      }

      if (data) {
        setEntitlements({
          games_played: data.games_played ?? 0,
          has_base_game: !!data.has_base_game,
          has_all_access: !!data.has_all_access,
        });
        return;
      }

      // No row yet — initialize one.
      const { data: inserted, error: insertError } = await supabase
        .from("user_entitlements")
        .insert({ user_id: uid, ...DEFAULT_ENTITLEMENTS })
        .select("games_played, has_base_game, has_all_access")
        .single();

      if (activeUidRef.current !== uid) return; // stale

      if (insertError) {
        console.error("[auth] failed to create entitlements:", insertError.message);
        setEntitlements(null);
        return;
      }

      setEntitlements({
        games_played: inserted.games_played ?? 0,
        has_base_game: !!inserted.has_base_game,
        has_all_access: !!inserted.has_all_access,
      });
    } finally {
      if (activeUidRef.current === uid) setEntitlementsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Provision/load entitlements whenever the signed-in user changes.
  useEffect(() => {
    if (!user) {
      provisionedFor.current = null;
      activeUidRef.current = null;
      setEntitlements(null);
      return;
    }
    if (provisionedFor.current === user.id) return;
    provisionedFor.current = user.id;
    activeUidRef.current = user.id;
    setEntitlements(null); // clear any prior user's entitlements before fetch
    void loadEntitlements(user.id);
  }, [user]);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    return { error: error?.message ?? null };
  };

  const signInWithEmail = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setEntitlements(null);
    provisionedFor.current = null;
  };

  const refreshEntitlements = async () => {
    if (user) await loadEntitlements(user.id);
  };

  const incrementGamesPlayed = async () => {
    if (!user) return;
    // Optimistic local bump so the gate reacts instantly without blocking UI.
    setEntitlements((prev) =>
      prev ? { ...prev, games_played: prev.games_played + 1 } : prev,
    );
    const { error } = await supabase.rpc("increment_games_played");
    if (error) {
      console.error("[auth] increment_games_played failed:", error.message);
      // Re-sync from the source of truth on failure.
      void refreshEntitlements();
    }
  };

  // Fail-closed: only allow a game start once entitlements are loaded and
  // actually permit it. While loading (entitlements === null) the gate stays
  // closed so a user can't slip past the free-game limit during the fetch.
  const canStartGame = entitlements
    ? entitlements.has_base_game ||
      entitlements.has_all_access ||
      entitlements.games_played < FREE_GAME_LIMIT
    : false;

  const value: AuthContextValue = {
    user,
    session,
    entitlements,
    loading,
    entitlementsLoading,
    canStartGame,
    signInWithGoogle,
    signInWithEmail,
    signOut,
    incrementGamesPlayed,
    refreshEntitlements,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
