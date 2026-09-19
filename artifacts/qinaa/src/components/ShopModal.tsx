import { useState, type FormEvent } from "react";
import {
  ADD_ON_ITEM_IDS,
  FREE_GAME_LIMIT,
  QINAA_CATALOG,
  formatSarAmount,
} from "@workspace/qinaa-rules";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { getRoleName } from "../lib/roles";
import { RoleRevealCard } from "./RoleRevealCard";
import { AuthModal } from "./AuthModal";
import { RtlEmoji } from "./RtlEmoji";
import { apiPostAuthenticated } from "../lib/api";

const ADD_ON_IDS = new Set<string>(ADD_ON_ITEM_IDS);

const ITEM_LABELS: Record<string, string> = {
  base_game: "اللعبة الأساسية",
  all_access: "الباقة الشاملة",
  role_wizard: "دور الساحر",
  role_madman: "دور المجنون",
  role_avenger: "دور المنتقم",
  role_twins: "دور التوأم",
  role_sniper: "دور القناص",
};

function normalizeSaudiMobile(value: string): string {
  const latinDigits = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  const compact = latinDigits.replace(/[\s()-]/g, "");
  return compact.startsWith("+966") ? compact.slice(1) : compact;
}

function isValidSaudiMobile(value: string): boolean {
  return /^(?:05\d{8}|9665\d{8})$/.test(value);
}

function checkoutErrorMessage(error?: string): string {
  switch (error) {
    case "base_game_required":
      return "يلزم شراء اللعبة الأساسية قبل شراء دور منفرد.";
    case "already_owned":
      return "هذا العنصر مملوك في حسابك بالفعل.";
    case "invalid_client_name":
      return "تحقق من الاسم ثم حاول مرة أخرى.";
    case "invalid_client_mobile":
      return "تحقق من رقم الجوال السعودي ثم حاول مرة أخرى.";
    case "invalid_auth_token":
    case "missing_auth_token":
      return "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.";
    case "payment_not_configured":
      return "بوابة الدفع غير مهيأة حاليًا.";
    case "payment_gateway_inactive":
      return "بوابة الدفع تنتظر تفعيل حساب التاجر.";
    default:
      return "تعذّر بدء عملية الدفع. حاول مرة أخرى.";
  }
}

/**
 * Pricing / packages modal. Each "buy" button starts a Paylink hosted checkout for
 * a lifetime entitlement (unlock happens server-side via the
 * verified Paylink flow). The card footers react to the live entitlement state so the
 * user's current tier is always reflected.
 * Rendered globally via ShopProvider so it can be opened from anywhere
 * (footer button, entitlement gatekeeper, etc.).
 */
export function ShopModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Track WHICH item is checking out so only its button shows the loading
  // state; the rest stay normal-looking but disabled while one is in flight.
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  // When a guest taps a purchase / try action we surface the login flow instead
  // of hitting checkout — the catalog itself stays public for browsing.
  const [showAuth, setShowAuth] = useState(false);
  const [checkoutItemId, setCheckoutItemId] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientMobile, setClientMobile] = useState("");
  const {
    user,
    entitlements,
    entitlementsLoading,
    refreshEntitlements,
  } = useAuth();

  const hasBase = !!entitlements?.has_base_game;
  const hasAll = !!entitlements?.has_all_access;
  const hasBaseAccess = hasBase || hasAll;
  const freeRemaining = entitlements
    ? Math.max(0, FREE_GAME_LIMIT - entitlements.games_played)
    : null;
  const checkingEntitlements = !!user && (entitlementsLoading || !entitlements);
  const currentTier: "free" | "base" | "all_access" = hasAll
    ? "all_access"
    : hasBase
      ? "base"
      : "free";

  const busy = loadingItemId !== null;

  const handleBuy = (itemId: string) => {
    if (busy) return;
    // Guests can browse the catalog but must authenticate before any checkout.
    if (!user) {
      setShowAuth(true);
      return;
    }
    if (ADD_ON_IDS.has(itemId) && !hasBaseAccess) {
      toast.error("يلزم شراء اللعبة الأساسية قبل شراء دور منفرد.");
      return;
    }

    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const suggestedName = [
      metadata.full_name,
      metadata.name,
      metadata.display_name,
    ].find(
      (value): value is string =>
        typeof value === "string" && value.trim().length >= 2,
    );

    setClientName((current) => current || suggestedName?.trim() || "");
    setClientMobile((current) => current || user.phone || "");
    setCheckoutItemId(itemId);
  };

  const startCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!checkoutItemId || busy || !user) return;

    const normalizedName = clientName.trim().replace(/\s+/g, " ");
    const normalizedMobile = normalizeSaudiMobile(clientMobile);
    if (normalizedName.length < 2) {
      toast.error("اكتب الاسم المستخدم في فاتورة الدفع.");
      return;
    }
    if (!isValidSaudiMobile(normalizedMobile)) {
      toast.error("اكتب رقمًا سعوديًا بصيغة 05xxxxxxxx أو 9665xxxxxxxx.");
      return;
    }

    setLoadingItemId(checkoutItemId);
    try {
      const { resp, data } = await apiPostAuthenticated<{
        checkoutUrl?: string;
        error?: string;
      }>(
        "/api/payment/paylink-invoice",
        {
          itemId: checkoutItemId,
          clientName: normalizedName,
          clientMobile: normalizedMobile,
        },
      );

      if (!resp || !resp.ok) {
        const authFailed =
          !resp ||
          resp.status === 401 ||
          data.error === "missing_auth_token" ||
          data.error === "invalid_auth_token";
        if (authFailed) {
          setCheckoutItemId(null);
          setShowAuth(true);
        }
        console.error("Paylink checkout failed:", resp?.status, data);
        toast.error(
          checkoutErrorMessage(authFailed ? "invalid_auth_token" : data.error),
        );
        return;
      }

      const checkoutUrl = data.checkoutUrl;
      if (typeof checkoutUrl !== "string" || !checkoutUrl) {
        console.error("Paylink checkout response missing checkoutUrl:", data);
        throw new Error("missing checkout url");
      }

      window.location.assign(checkoutUrl);
    } catch (err) {
      console.error("Checkout error:", err);
      const error = err instanceof Error ? err.message : undefined;
      toast.error(checkoutErrorMessage(error));
    } finally {
      setLoadingItemId(null);
    }
  };

  if (!open) return null;

  // Neutral placeholder shown in the tier card footers while we don't yet know
  // the user's entitlements (avoids briefly assuming the free tier).
  const checkingBadge = entitlementsLoading ? (
    <div
      className="w-full text-center py-2.5 rounded-xl text-sm font-bold"
      style={{
        backgroundColor: "#1A1A1A",
        color: "#666666",
        border: "1px solid #2A2A2A",
      }}
    >
      جارٍ التحقق…
    </div>
  ) : (
    <button
      type="button"
      onClick={() => { void refreshEntitlements(); }}
      className="w-full text-center py-2.5 rounded-xl text-sm font-bold transition-colors hover:text-white"
      style={{
        backgroundColor: "#211414",
        color: "#FCA5A5",
        border: "1px solid rgba(239,68,68,0.32)",
      }}
    >
      تعذّر التحقق — إعادة المحاولة
    </button>
  );

  // Each add-on is the shared in-game RoleRevealCard (single source of truth for
  // the role art + ability copy) with its purchase control beneath it. roleKey
  // maps to ROLE_META / getRoleName in ./lib/roles.
  const addOns: { id: string; roleKey: string }[] = [
    { id: "role_wizard", roleKey: "magician" },
    { id: "role_madman", roleKey: "madman" },
    { id: "role_avenger", roleKey: "avenger" },
    { id: "role_twins", roleKey: "twin" },
    { id: "role_sniper", roleKey: "sniper" },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{
          backgroundColor: "rgba(0,0,0,0.88)",
          backdropFilter: "blur(12px)",
        }}
        onClick={onClose}
      >
        <div
          dir="rtl"
          className="fixed top-0 inset-x-0 z-[60] flex items-center justify-between px-4 md:px-8 lg:px-12 py-4 pointer-events-none"
        >
          <button
            onClick={onClose}
            className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full text-white/70 hover:text-white transition-colors active:scale-90"
            style={{
              backgroundColor: "rgba(13,13,13,0.55)",
              border: "1px solid rgba(255,255,255,0.06)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div
          dir="rtl"
          className="w-full max-w-md sm:max-w-xl md:max-w-3xl lg:max-w-4xl rounded-2xl p-6 flex flex-col gap-5 shadow-2xl overflow-y-auto max-h-[85vh]"
          style={{
            backgroundColor: "#111111",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex flex-col items-center gap-1 text-center pt-1">
            <h2 className="text-xl font-black text-white">باقات القناع</h2>
            <p className="text-sm" style={{ color: "#888888" }}>
              اختر تجربتك
            </p>
          </div>
          <div
            style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)" }}
          />

          {/* Pricing grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1 — Free */}
            <div
              className="flex flex-col gap-4 rounded-2xl p-5"
              style={{
                backgroundColor: "#0D0D0D",
                border: "1px solid #222222",
              }}
            >
              <div className="flex flex-col gap-1">
                <span className="text-base font-black text-white">
                  التجربة المجانية
                </span>
                <span
                  className="text-2xl font-black"
                  style={{ color: "#AAAAAA" }}
                >
                  مجاناً
                </span>
              </div>
              <div
                style={{
                  height: "1px",
                  backgroundColor: "rgba(255,255,255,0.06)",
                }}
              />
              <p
                className="text-sm leading-relaxed flex-1"
                style={{ color: "#888888" }}
              >
                تجربتان بالأدوار الرئيسية. تُحسب التجربة بعد اكتمال الليلة
                الأولى، والخروج قبلها لا يستهلكها.
              </p>
              {checkingEntitlements ? (
                checkingBadge
              ) : !user ? (
                <button
                  type="button"
                  onClick={() => setShowAuth(true)}
                  className="w-full text-center py-2.5 rounded-xl text-sm font-bold transition-all duration-150 hover:bg-neutral-700 active:scale-95"
                  style={{
                    backgroundColor: "#1A1A1A",
                    color: "#FFFFFF",
                    border: "1px solid #333333",
                  }}
                >
                  جرب الآن
                </button>
              ) : (
                <div
                  className="w-full text-center py-2.5 rounded-xl text-sm font-bold"
                  style={{
                    backgroundColor: "#1A1A1A",
                    color: "#666666",
                    border: "1px solid #2A2A2A",
                  }}
                >
                  {currentTier !== "free"
                    ? "تمت الترقية"
                    : freeRemaining && freeRemaining > 0
                      ? `المتبقي ${freeRemaining} من ${FREE_GAME_LIMIT}`
                      : "انتهت التجربتان"}
                </div>
              )}
            </div>

            {/* Card 2 — Base */}
            <div
              className="flex flex-col gap-4 rounded-2xl p-5"
              style={{
                backgroundColor: "#0D0D0D",
                border: "1px solid #2A2A2A",
              }}
            >
              <div className="flex flex-col gap-1">
                <span className="text-base font-black text-white">
                  اللعبة الأساسية
                </span>
                <span className="text-2xl font-black text-white">
                  {formatSarAmount(QINAA_CATALOG.base_game.amount)}{" "}
                  <span className="text-base font-bold">ر.س</span>
                </span>
              </div>
              <div
                style={{
                  height: "1px",
                  backgroundColor: "rgba(255,255,255,0.06)",
                }}
              />
              <p
                className="text-sm leading-relaxed flex-1"
                style={{ color: "#888888" }}
              >
                وصول لا محدود للأدوار الرئيسية للأبد.
              </p>
              {checkingEntitlements ? (
                checkingBadge
              ) : hasBaseAccess ? (
                <div
                  className="w-full text-center py-2.5 rounded-xl text-sm font-bold"
                  style={{
                    backgroundColor: "rgba(34,197,94,0.12)",
                    color: "#4ADE80",
                    border: "1px solid rgba(34,197,94,0.35)",
                  }}
                >
                  {currentTier === "base" ? "الباقة الحالية ✓" : "مُضمّنة ✓"}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleBuy("base_game")}
                  disabled={busy}
                  className="w-full text-center py-2.5 rounded-xl text-sm font-bold transition-all duration-150 hover:bg-neutral-700 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: "#1A1A1A",
                    color: "#FFFFFF",
                    border: "1px solid #333333",
                  }}
                >
                  {loadingItemId === "base_game" ? "جارٍ التحويل…" : "شراء"}
                </button>
              )}
            </div>

            {/* Card 3 — All-Access VIP (highlighted) */}
            <div
              className="relative flex flex-col gap-4 rounded-2xl p-5"
              style={{
                backgroundColor: "#161106",
                border: "1px solid #F59E0B",
                boxShadow: "0 0 28px rgba(245,158,11,0.18)",
              }}
            >
              {/* Top badge */}
              <span
                className="absolute -top-3 right-5 text-[11px] font-black px-3 py-1 rounded-full"
                style={{ backgroundColor: "#F59E0B", color: "#1A1206" }}
              >
                الأكثر قيمة
              </span>
              <div className="flex flex-col gap-1">
                <RtlEmoji
                  text="الباقة الشاملة"
                  emoji="👑"
                  className="text-base font-black"
                  textStyle={{ color: "#FBBF24" }}
                  justify="start"
                />
                <span
                  className="text-2xl font-black"
                  style={{ color: "#FBBF24" }}
                >
                  {formatSarAmount(QINAA_CATALOG.all_access.amount)}{" "}
                  <span className="text-base font-bold">ر.س</span>
                </span>
              </div>
              <div
                style={{
                  height: "1px",
                  backgroundColor: "rgba(245,158,11,0.22)",
                }}
              />
              <p
                className="text-sm leading-relaxed flex-1"
                style={{ color: "#D4B97A" }}
              >
                اللعبة الأساسية وجميع الأدوار الإضافية الحالية والقادمة بلا
                قيود.
              </p>
              {checkingEntitlements ? (
                checkingBadge
              ) : hasAll ? (
                <div
                  className="w-full text-center py-2.5 rounded-xl text-sm font-black"
                  style={{
                    backgroundColor: "rgba(245,158,11,0.16)",
                    color: "#FBBF24",
                    border: "1px solid rgba(245,158,11,0.5)",
                  }}
                >
                  الباقة الحالية ✓
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleBuy("all_access")}
                  disabled={busy}
                  className="w-full text-center py-2.5 rounded-xl text-sm font-black transition-all duration-150 hover:brightness-110 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ backgroundColor: "#F59E0B", color: "#1A1206" }}
                >
                  {loadingItemId === "all_access"
                    ? "جارٍ التحويل…"
                    : "احصل عليها"}
                </button>
              )}
            </div>
          </div>

          {/* ── A-la-carte add-ons ── */}
          <div className="w-full h-px bg-neutral-800 my-6"></div>
          <h4 className="text-white font-bold mb-4 text-right">
            الإضافات المفردة (تتطلب اللعبة الأساسية)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {addOns.map(({ id, roleKey }) => {
              // All-Access cascades to every add-on; otherwise the role must be in
              // the user's purchased owned_items list.
              const owned =
                hasAll || (entitlements?.owned_items?.includes(id) ?? false);
              const requiresBase = !!user && !hasBaseAccess;
              const name = getRoleName(roleKey);
              return (
                <div key={id} dir="rtl" className="flex flex-col gap-3">
                  <RoleRevealCard roleKey={roleKey} />
                  {owned ? (
                    <div
                      className="w-full py-2 rounded-lg text-sm font-black text-center"
                      style={{
                        backgroundColor: "rgba(34,197,94,0.12)",
                        color: "#4ADE80",
                        border: "1px solid rgba(34,197,94,0.35)",
                      }}
                    >
                      {name} • مملوك ✓
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleBuy(id)}
                      disabled={busy || entitlementsLoading || requiresBase}
                      className="w-full py-2 rounded-lg text-sm font-black text-amber-400 transition-all duration-150 hover:bg-amber-400 hover:text-neutral-950 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.35)",
                      }}
                    >
                      {requiresBase
                        ? "اشترِ اللعبة الأساسية أولاً"
                        : loadingItemId === id
                          ? "جارٍ التحويل…"
                          : `شراء ${name} • ${formatSarAmount(QINAA_CATALOG[id as keyof typeof QINAA_CATALOG].amount)} ر.س`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-center text-xs" style={{ color: "#555555" }}>
            جميع الأسعار دفعة واحدة لوصول دائم وليست اشتراكًا. الإضافات
            المفردة تتطلب اللعبة الأساسية، وتُعالَج المدفوعات عبر بوابة آمنة.
          </p>
        </div>
      </div>
      {/* Login popup — surfaced when a guest taps Try Now / Buy inside the shop.
        Wrapped in a z-70 stacking context so it sits above the shop's z-60 header. */}
      {showAuth && (
        <div style={{ position: "relative", zIndex: 70 }}>
          <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
        </div>
      )}
      {checkoutItemId && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[80] flex items-center justify-center px-4"
          style={{
            backgroundColor: "rgba(0,0,0,0.82)",
            backdropFilter: "blur(10px)",
          }}
          onClick={() => {
            if (!busy) setCheckoutItemId(null);
          }}
        >
          <form
            onSubmit={startCheckout}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-4 shadow-2xl"
            style={{
              backgroundColor: "#111111",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-white">
                  إكمال بيانات الدفع
                </h3>
                <p className="mt-1 text-xs text-neutral-400">
                  {ITEM_LABELS[checkoutItemId] ?? "عملية الشراء"} عبر بيلينك
                </p>
              </div>
              <button
                type="button"
                aria-label="إغلاق"
                disabled={busy}
                onClick={() => setCheckoutItemId(null)}
                className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-neutral-400 hover:text-white disabled:opacity-50"
                style={{ backgroundColor: "#1A1A1A" }}
              >
                <X size={17} />
              </button>
            </div>

            <label className="flex flex-col gap-2 text-sm font-bold text-neutral-200">
              الاسم
              <input
                type="text"
                autoComplete="name"
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                disabled={busy}
                maxLength={80}
                placeholder="الاسم المستخدم في الفاتورة"
                className="w-full rounded-xl px-3.5 py-3 text-white outline-none focus:border-amber-500 disabled:opacity-60"
                style={{
                  backgroundColor: "#0A0A0A",
                  border: "1px solid #303030",
                }}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-bold text-neutral-200">
              رقم الجوال السعودي
              <input
                dir="ltr"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={clientMobile}
                onChange={(event) => setClientMobile(event.target.value)}
                disabled={busy}
                maxLength={20}
                placeholder="05xxxxxxxx"
                className="w-full rounded-xl px-3.5 py-3 text-left text-white outline-none focus:border-amber-500 disabled:opacity-60"
                style={{
                  backgroundColor: "#0A0A0A",
                  border: "1px solid #303030",
                }}
              />
              <span className="text-[11px] font-normal text-neutral-500">
                يقبل 05xxxxxxxx أو 9665xxxxxxxx
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => setCheckoutItemId(null)}
                className="rounded-xl py-3 text-sm font-bold text-neutral-300 disabled:opacity-50"
                style={{
                  backgroundColor: "#1A1A1A",
                  border: "1px solid #303030",
                }}
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl py-3 text-sm font-black text-neutral-950 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#F59E0B" }}
              >
                {busy ? "جارٍ التحويل…" : "المتابعة للدفع"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
