import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { getRoleName } from "../lib/roles";
import { RoleRevealCard } from "./RoleRevealCard";
import { AuthModal } from "./AuthModal";
import { RtlEmoji } from "./RtlEmoji";
import { readResponseJson } from "../lib/api";

/**
 * Pricing / packages modal. Each "buy" button starts a Tap hosted checkout for
 * the premium subscription (entitlement unlock happens server-side via the
 * Tap webhook). The card footers react to the live entitlement state so the
 * user's current tier is always reflected.
 * Rendered globally via ShopProvider so it can be opened from anywhere
 * (footer button, entitlement gatekeeper, etc.).
 */
export function ShopModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Track WHICH item is checking out so only its button shows the loading
  // state; the rest stay normal-looking but disabled while one is in flight.
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  // When a guest taps a purchase / try action we surface the login flow instead
  // of hitting checkout — the catalog itself stays public for browsing.
  const [showAuth, setShowAuth] = useState(false);
  const { user, entitlements, entitlementsLoading } = useAuth();

  const hasBase = !!entitlements?.has_base_game;
  const hasAll = !!entitlements?.has_all_access;
  const currentTier: "free" | "base" | "all_access" = hasAll
    ? "all_access"
    : hasBase
      ? "base"
      : "free";

  const busy = loadingItemId !== null;

  const handleBuy = async (itemId: string) => {
    if (busy) return;
    // Guests can browse the catalog but must authenticate before any checkout.
    if (!user) { setShowAuth(true); return; }
    if (!user.email) {
      toast.error("يرجى تسجيل الدخول بحساب يحتوي على بريد إلكتروني.");
      return;
    }
    setLoadingItemId(itemId);
    try {
      const apiUrl = import.meta.env.VITE_PUBLIC_SERVER_URL
        ? `${import.meta.env.VITE_PUBLIC_SERVER_URL}/api/payment/tap-charge`
        : "/api/payment/tap-charge";

      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email: user.email }),
      });

      const data = await readResponseJson<{ checkoutUrl?: string; error?: string }>(resp);

      if (!resp.ok) {
        console.error("Tap checkout failed:", resp.status, data);
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `checkout failed: ${resp.status}`,
        );
      }

      const checkoutUrl = data.checkoutUrl;
      if (typeof checkoutUrl !== "string" || !checkoutUrl) {
        console.error("Tap checkout response missing checkoutUrl:", data);
        throw new Error("missing checkout url");
      }

      window.location.href = checkoutUrl;
    } catch (err) {
      console.error("Checkout error:", err);
      toast.error("تعذّر بدء عملية الدفع. حاول مرة أخرى.");
      setLoadingItemId(null);
    }
  };

  if (!open) return null;

  // Neutral placeholder shown in the tier card footers while we don't yet know
  // the user's entitlements (avoids briefly assuming the free tier).
  const checkingBadge = (
    <div
      className="w-full text-center py-2.5 rounded-xl text-sm font-bold"
      style={{ backgroundColor: "#1A1A1A", color: "#666666", border: "1px solid #2A2A2A" }}>
      جارٍ التحقق…
    </div>
  );

  // Each add-on is the shared in-game RoleRevealCard (single source of truth for
  // the role art + ability copy) with its purchase control beneath it. roleKey
  // maps to ROLE_META / getRoleName in ./lib/roles.
  const addOns: { id: string; roleKey: string }[] = [
    { id: "role_wizard", roleKey: "magician" },
    { id: "role_madman", roleKey: "madman" },
    { id: "role_avenger", roleKey: "avenger" },
    { id: "role_twins", roleKey: "twin" },
  ];

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(12px)" }}
      onClick={onClose}>
      <div
        dir="rtl"
        className="fixed top-0 inset-x-0 z-[60] flex items-center justify-between px-4 md:px-8 lg:px-12 py-4 pointer-events-none">
        <button
          onClick={onClose}
          className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full text-white/70 hover:text-white transition-colors active:scale-90"
          style={{ backgroundColor: "rgba(13,13,13,0.55)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      <div
        dir="rtl"
        className="w-full max-w-md sm:max-w-xl md:max-w-3xl lg:max-w-4xl rounded-2xl p-6 flex flex-col gap-5 shadow-2xl overflow-y-auto max-h-[85vh]"
        style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex flex-col items-center gap-1 text-center pt-1">
          <h2 className="text-xl font-black text-white">باقات القناع</h2>
          <p className="text-sm" style={{ color: "#888888" }}>اختر تجربتك</p>
        </div>
        <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)" }} />

        {/* Pricing grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Card 1 — Free */}
          <div className="flex flex-col gap-4 rounded-2xl p-5"
            style={{ backgroundColor: "#0D0D0D", border: "1px solid #222222" }}>
            <div className="flex flex-col gap-1">
              <span className="text-base font-black text-white">التجربة المجانية</span>
              <span className="text-2xl font-black" style={{ color: "#AAAAAA" }}>مجاناً</span>
            </div>
            <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)" }} />
            <p className="text-sm leading-relaxed flex-1" style={{ color: "#888888" }}>
            وصول مجاني للأدوار الرئيسية لمرتين فقط.
            </p>
            {entitlementsLoading ? (
              checkingBadge
            ) : !user ? (
              <button
                type="button"
                onClick={() => setShowAuth(true)}
                className="w-full text-center py-2.5 rounded-xl text-sm font-bold transition-all duration-150 hover:bg-neutral-700 active:scale-95"
                style={{ backgroundColor: "#1A1A1A", color: "#FFFFFF", border: "1px solid #333333" }}>
                جرب الآن
              </button>
            ) : (
              <div
                className="w-full text-center py-2.5 rounded-xl text-sm font-bold"
                style={{ backgroundColor: "#1A1A1A", color: "#666666", border: "1px solid #2A2A2A" }}>
                {currentTier === "free" ? "الباقة الحالية" : "تمت الترقية"}
              </div>
            )}
          </div>

          {/* Card 2 — Base */}
          <div className="flex flex-col gap-4 rounded-2xl p-5"
            style={{ backgroundColor: "#0D0D0D", border: "1px solid #2A2A2A" }}>
            <div className="flex flex-col gap-1">
              <span className="text-base font-black text-white">اللعبة الأساسية</span>
              <span className="text-2xl font-black text-white">
                14.99 <span className="text-base font-bold">ر.س</span>
              </span>
            </div>
            <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)" }} />
            <p className="text-sm leading-relaxed flex-1" style={{ color: "#888888" }}>
              وصول لا محدود للأدوار الرئيسية للأبد.
            </p>
            {entitlementsLoading ? (
              checkingBadge
            ) : hasBase ? (
              <div
                className="w-full text-center py-2.5 rounded-xl text-sm font-bold"
                style={{
                  backgroundColor: "rgba(34,197,94,0.12)",
                  color: "#4ADE80",
                  border: "1px solid rgba(34,197,94,0.35)",
                }}>
                {currentTier === "base" ? "الباقة الحالية ✓" : "مُضمّنة ✓"}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleBuy("base_game")}
                disabled={busy}
                className="w-full text-center py-2.5 rounded-xl text-sm font-bold transition-all duration-150 hover:bg-neutral-700 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#1A1A1A", color: "#FFFFFF", border: "1px solid #333333" }}>
                {loadingItemId === "base_game" ? "جارٍ التحويل…" : "شراء"}
              </button>
            )}
          </div>

          {/* Card 3 — All-Access VIP (highlighted) */}
          <div className="relative flex flex-col gap-4 rounded-2xl p-5"
            style={{ backgroundColor: "#161106", border: "1px solid #F59E0B", boxShadow: "0 0 28px rgba(245,158,11,0.18)" }}>
            {/* Top badge */}
            <span
              className="absolute -top-3 right-5 text-[11px] font-black px-3 py-1 rounded-full"
              style={{ backgroundColor: "#F59E0B", color: "#1A1206" }}>
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
              <span className="text-2xl font-black" style={{ color: "#FBBF24" }}>
                29.99 <span className="text-base font-bold">ر.س</span>
              </span>
            </div>
            <div style={{ height: "1px", backgroundColor: "rgba(245,158,11,0.22)" }} />
            <p className="text-sm leading-relaxed flex-1" style={{ color: "#D4B97A" }}>
            التجربة الكاملة للعبة بجميع أدوارها بلا قيود.
            </p>
            {entitlementsLoading ? (
              checkingBadge
            ) : hasAll ? (
              <div
                className="w-full text-center py-2.5 rounded-xl text-sm font-black"
                style={{
                  backgroundColor: "rgba(245,158,11,0.16)",
                  color: "#FBBF24",
                  border: "1px solid rgba(245,158,11,0.5)",
                }}>
                الباقة الحالية ✓
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleBuy("all_access")}
                disabled={busy}
                className="w-full text-center py-2.5 rounded-xl text-sm font-black transition-all duration-150 hover:brightness-110 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: "#F59E0B", color: "#1A1206" }}>
                {loadingItemId === "all_access" ? "جارٍ التحويل…" : "احصل عليها"}
              </button>
            )}
          </div>

        </div>

        {/* ── A-la-carte add-ons ── */}
        <div className="w-full h-px bg-neutral-800 my-6"></div>
        <h4 className="text-white font-bold mb-4 text-right">الإضافات المفردة (تتطلب اللعبة الأساسية)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {addOns.map(({ id, roleKey }) => {
            // All-Access cascades to every add-on; otherwise the role must be in
            // the user's purchased owned_items list.
            const owned = hasAll || (entitlements?.owned_items?.includes(id) ?? false);
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
                    }}>
                    {name} • مملوك ✓
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleBuy(id)}
                    disabled={busy || entitlementsLoading}
                    className="w-full py-2 rounded-lg text-sm font-black text-amber-400 transition-all duration-150 hover:bg-amber-400 hover:text-neutral-950 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: "rgba(245,158,11,0.08)",
                      border: "1px solid rgba(245,158,11,0.35)",
                    }}>
                    {loadingItemId === id ? "جارٍ التحويل…" : `شراء ${name} • 7.99 ر.س`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs" style={{ color: "#555555" }}>
          الأسعار قابلة للتغيير. تُعالَج المدفوعات عبر بوابة دفع آمنة.
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
    </>
  );
}
