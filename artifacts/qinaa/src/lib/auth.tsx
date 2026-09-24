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
import {
  supabase,
  INITIAL_COUNCIL_CREDITS,
  type Entitlements,
} from "./supabase";
import { ROLE_ITEM_IDS } from "@workspace/qinaa-rules";
import { apiPostAuthenticated } from "./api";

const DEFAULT_ENTITLEMENTS: Entitlements = {
  game_credits: INITIAL_COUNCIL_CREDITS,
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
  /** Idempotently settles the free-game counter for one completed game. */
  consumeGameCredit: (
    gameId: string,
  ) => Promise<"settled" | "limit_reached" | "retry">;
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
  if (!itemId) return ent.game_credits > 0 || ent.owned_items.length > 0;
  if (itemId.startsWith("councils_")) return ent.game_credits > 0;
  if (itemId === "roles_bundle" || itemId === "full_bundle") {
    return ROLE_ITEM_IDS.every((roleId) => ent.owned_items.includes(roleId));
  }
  return ent.owned_items.includes(itemId);
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
    game_credits?: number | null;
    games_played?: number | null;
    has_base_game?: boolean | null;
    has_all_access?: boolean | null;
    owned_items?: string[] | null;
  }): Entitlements => ({
    game_credits: Math.max(0, data.game_credits ?? INITIAL_COUNCIL_CREDITS),
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
  const loadEntitlements = useCallback(
    async (uid: string): Promise<Entitlements | null> => {
      setEntitlementsLoading(true);
      try {
        const { data, error } = await supabase
          .from("user_entitlements")
          .select("game_credits, games_played, has_base_game, has_all_access, owned_items")
          .eq("id", uid)
          .maybeSingle();

        if (activeUidRef.current !== uid) return entitlementsRef.current;

        if (error) {
          console.error("Supabase Entitlement Error:", error);
          entitlementsRef.current = null;
          setEntitlements(null);
          return null;
        }

        if (data) {
          const next = mapEntitlements(data);
          applyEntitlements(next);
          return next;
        }

        const { data: inserted, error: insertError } = await supabase
          .from("user_entitlements")
          .insert({ id: uid, ...DEFAULT_ENTITLEMENTS })
          .select("game_credits, games_played, has_base_game, has_all_access, owned_items")
          .single();

        if (activeUidRef.current !== uid) return entitlementsRef.current;

        if (insertError?.code === "23505") {
          // Another tab may have provisioned the same first-login row between
          // our SELECT and INSERT. Read that authoritative row instead of
          // turning a harmless race into a permanent loading state.
          const { data: concurrentRow, error: concurrentReadError } =
            await supabase
              .from("user_entitlements")
              .select("game_credits, games_played, has_base_game, has_all_access, owned_items")
              .eq("id", uid)
              .single();

          if (activeUidRef.current !== uid) return entitlementsRef.current;
          if (!concurrentReadError && concurrentRow) {
            const next = mapEntitlements(concurrentRow);
            applyEntitlements(next);
            return next;
          }
        }

        if (insertError) {
          console.error("Supabase Entitlement Error:", insertError);
          entitlementsRef.current = null;
          setEntitlements(null);
          return null;
        }

        const next = mapEntitlements(inserted);
        applyEntitlements(next);
        return next;
      } catch (error) {
        console.error("Supabase Entitlement Error:", error);
        if (activeUidRef.current === uid) {
          entitlementsRef.current = null;
          setEntitlements(null);
          return null;
        }
        return entitlementsRef.current;
      } finally {
        if (activeUidRef.current === uid) setEntitlementsLoading(false);
      }
    },
    [],
  );

  const loadProfile = useCallback(
    async (uid: string): Promise<UserProfile | null> => {
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
    },
    [],
  );

  const refreshEntitlements =
    useCallback(async (): Promise<Entitlements | null> => {
      const uid = await resolveUserId();
      if (!uid) return null;
      activeUidRef.current = uid;
      return loadEntitlements(uid);
    }, [loadEntitlements, resolveUserId]);

  const refreshAfterPurchase =
    useCallback(async (): Promise<Entitlements | null> => {
      const uid = await resolveUserId();
      if (!uid) return null;
      activeUidRef.current = uid;
      const [ent] = await Promise.all([
        loadEntitlements(uid),
        loadProfile(uid),
      ]);
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

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
      },
    );

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
    try {
      const { resp, data } = await apiPostAuthenticated<{
        ok?: boolean;
        error?: string;
      }>(
        "/api/account/delete",
        {},
      );

      // Fail closed: a static host can return an empty HTTP 200 for an unknown
      // POST route. Only the API's explicit acknowledgement means deletion.
      if (!resp || !resp.ok || data.ok !== true) {
        return { error: data.error ?? "delete_failed" };
      }

      localStorage.removeItem("qinaa_narrator_state");
      localStorage.removeItem("qinaa_setup_prefs");
    } catch (err) {
      console.error("Account deletion failed:", err);
      return { error: "delete_failed" };
    }

    await signOut();
    return { error: null };
  };

  const consumeGameCredit = async (
    gameId: string,
  ): Promise<"settled" | "limit_reached" | "retry"> => {
    if (!user || !gameId) return "retry";

    const { data, error } = await supabase.rpc("consume_game_credit", {
      target_game_id: gameId,
    });
    if (error) {
      console.error("Supabase Entitlement Error:", error);
      await refreshEntitlements();
      return "retry";
    }

    const result = Array.isArray(data) ? data[0] : null;
    if (!result || typeof result.status !== "string") {
      console.error("Supabase Entitlement Error: invalid consume_game_credit response");
      await refreshEntitlements();
      return "retry";
    }

    // The RPC is serialized per user and idempotent per game id. Refreshing
    // makes this tab match the authoritative value even after a duplicate retry
    // or when the account became paid while the game was in progress.
    await refreshEntitlements();
    if (result.status === "limit_reached") return "limit_reached";
    return ["consumed", "already_consumed"].includes(result.status)
      ? "settled"
      : "retry";
  };

  const canStartGame = (entitlements?.game_credits ?? 0) > 0;

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
    consumeGameCredit,
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
          <p className="text-white font-bold tracking-wide">
            جاري تهيئة اللعبة...
          </p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
