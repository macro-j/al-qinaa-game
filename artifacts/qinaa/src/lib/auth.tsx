import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, FREE_GAME_LIMIT, type Entitlements, getValidAccessToken } from "./supabase";
import { apiPost } from "./api";

const DEFAULT_ENTITLEMENTS: Entitlements = {
  games_played: 0,
  has_base_game: false,
  has_all_access: false,
  owned_items: [],
};

export type UserProfile = {
  is_premium: boolean;
  premium_until: string | null;
};

const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL ?? "/"}`;

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  entitlements: Entitlements | null;
  profile: UserProfile | null;
  loading: boolean;
  /** true while the entitlements row is being fetched/created */
  entitlementsLoading: boolean;
  /** can the user start another game right now? */
  canStartGame: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: string | null }>;
  incrementGamesPlayed: () => Promise<void>;
  refreshEntitlements: () => Promise<Entitlements | null>;
  /** Re-fetch entitlements + profile after a verified purchase. */
  refreshAfterPurchase: () => Promise<Entitlements | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

/** True when entitlements reflect the purchased item (or any paid unlock). */
export function entitlementsIncludePurchase(
  ent: Entitlements | null,
  itemId: string | null,
): boolean {
  if (!ent) return false;
  if (!itemId) {
    return ent.has_base_game || ent.has_all_access || ent.owned_items.length > 0;
  }
  if (itemId === "all_access") return ent.has_all_access;
  if (itemId === "base_game") return ent.has_base_game || ent.has_all_access;
  return ent.has_all_access || ent.owned_items.includes(itemId);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);

  // Tracks which user id we've already provisioned a row for, to avoid
  // redundant select/insert round-trips on every auth event.
  const provisionedFor = useRef<string | null>(null);
  // The uid whose entitlements are currently authoritative. Async fetches
  // compare against this so a response for a signed-out / switched account
  // can never overwrite the current user's state (stale-response guard).
  const activeUidRef = useRef<string | null>(null);
  // Latest entitlements for callers that need a return value after refresh.
  const entitlementsRef = useRef<Entitlements | null>(null);

  const mapEntitlements = (data: {
    games_played?: number | null;
    has_base_game?: boolean | null;
    has_all_access?: boolean | null;
    owned_items?: string[] | null;
  }): Entitlements => ({
    games_played: data.games_played ?? 0,
    has_base_game: !!data.has_base_game,
    has_all_access: !!data.has_all_access,
    owned_items: Array.isArray(data.owned_items) ? data.owned_items : [],
  });

  const applyEntitlements = (next: Entitlements) => {
    entitlementsRef.current = next;
    setEntitlements(next);
  };

  const resolveUserId = useCallback(async (): Promise<string | null> => {
    if (user?.id) return user.id;
    if (activeUidRef.current) return activeUidRef.current;
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  }, [user?.id]);

  // ── Fetch-or-create the user's entitlements row ──
  const loadEntitlements = useCallback(async (uid: string): Promise<Entitlements | null> => {
    setEntitlementsLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_entitlements")
        .select("games_played, has_base_game, has_all_access, owned_items")
        .eq("id", uid)
        .maybeSingle();

      if (activeUidRef.current !== uid) return entitlementsRef.current;

      if (error) {
        console.error("Supabase Entitlement Error:", error);
        applyEntitlements(DEFAULT_ENTITLEMENTS);
        return DEFAULT_ENTITLEMENTS;
      }

      if (data) {
        const next = mapEntitlements(data);
        applyEntitlements(next);
        return next;
      }

      const { data: inserted, error: insertError } = await supabase
        .from("user_entitlements")
        .insert({ id: uid, ...DEFAULT_ENTITLEMENTS })
        .select("games_played, has_base_game, has_all_access, owned_items")
        .single();

      if (activeUidRef.current !== uid) return entitlementsRef.current;

      if (insertError) {
        console.error("Supabase Entitlement Error:", insertError);
        applyEntitlements(DEFAULT_ENTITLEMENTS);
        return DEFAULT_ENTITLEMENTS;
      }

      const next = mapEntitlements(inserted);
      applyEntitlements(next);
      return next;
    } catch (error) {
      console.error("Supabase Entitlement Error:", error);
      if (activeUidRef.current === uid) {
        applyEntitlements(DEFAULT_ENTITLEMENTS);
        return DEFAULT_ENTITLEMENTS;
      }
      return entitlementsRef.current;
    } finally {
      if (activeUidRef.current === uid) setEntitlementsLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async (uid: string): Promise<UserProfile | null> => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_premium, premium_until")
        .eq("id", uid)
        .maybeSingle();

      if (activeUidRef.current !== uid) return null;

      if (error) {
        console.error("Supabase Profile Error:", error);
        return null;
      }

      if (!data) return null;

      const next: UserProfile = {
        is_premium: !!data.is_premium,
        premium_until: data.premium_until ?? null,
      };
      setProfile(next);
      return next;
    } catch (error) {
      console.error("Supabase Profile Error:", error);
      return null;
    }
  }, []);

  const refreshEntitlements = useCallback(async (): Promise<Entitlements | null> => {
    const uid = await resolveUserId();
    if (!uid) return null;
    activeUidRef.current = uid;
    return loadEntitlements(uid);
  }, [loadEntitlements, resolveUserId]);

  const refreshAfterPurchase = useCallback(async (): Promise<Entitlements | null> => {
    const uid = await resolveUserId();
    if (!uid) return null;
    activeUidRef.current = uid;
    const [ent] = await Promise.all([loadEntitlements(uid), loadProfile(uid)]);
    return ent;
  }, [loadEntitlements, loadProfile, resolveUserId]);

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
      entitlementsRef.current = null;
      setEntitlements(null);
      setProfile(null);
      return;
    }
    if (provisionedFor.current === user.id) return;
    provisionedFor.current = user.id;
    activeUidRef.current = user.id;
    setEntitlements(null);
    setProfile(null);
    void loadEntitlements(user.id);
    void loadProfile(user.id);
  }, [user, loadEntitlements, loadProfile]);

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
    setProfile(null);
    entitlementsRef.current = null;
    provisionedFor.current = null;
  };

  const deleteAccount = async (): Promise<{ error: string | null }> => {
    const token = await getValidAccessToken();
    if (!token) return { error: "not_authenticated" };

    const { resp, data } = await apiPost<{ ok?: boolean; error?: string }>(
      "/api/account/delete",
      {},
      { Authorization: `Bearer ${token}` },
    );

    if (!resp.ok) {
      return { error: data.error ?? "delete_failed" };
    }

    try {
      localStorage.removeItem("qinaa_narrator_state");
      localStorage.removeItem("qinaa_setup_prefs");
    } catch { /* ignore */ }

    await signOut();
    return { error: null };
  };

  const incrementGamesPlayed = async () => {
    if (!user) return;

    setEntitlements((prev) =>
      prev ? { ...prev, games_played: prev.games_played + 1 } : prev,
    );
    if (entitlementsRef.current) {
      entitlementsRef.current = {
        ...entitlementsRef.current,
        games_played: entitlementsRef.current.games_played + 1,
      };
    }

    const { error } = await supabase.rpc("increment_games_played");
    if (error) {
      console.error("Supabase Entitlement Error:", error);
      void refreshEntitlements();
    }
  };

  const canStartGame = entitlements
    ? entitlements.has_base_game ||
      entitlements.has_all_access ||
      entitlements.games_played < FREE_GAME_LIMIT
    : false;

  const value: AuthContextValue = {
    user,
    session,
    entitlements,
    profile,
    loading,
    entitlementsLoading,
    canStartGame,
    signInWithGoogle,
    signInWithEmail,
    signOut,
    deleteAccount,
    incrementGamesPlayed,
    refreshEntitlements,
    refreshAfterPurchase,
  };

  if (loading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: "#111111" }}
        dir="rtl"
      >
        <div className="flex flex-col items-center gap-5">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-white font-bold tracking-wide">جاري تهيئة اللعبة...</p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
