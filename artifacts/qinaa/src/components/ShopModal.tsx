import { useState } from "react";
import { X, VenetianMask, RotateCw, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

/**
 * Pricing / packages modal. Each "buy" button starts a Stripe Checkout for its
 * specific item (the actual entitlement unlock happens server-side via the
 * verified Stripe webhook / verify-on-return). The card footers react to the
 * live entitlement state so the user's current tier is always reflected.
 * Rendered globally via ShopProvider so it can be opened from anywhere
 * (footer button, entitlement gatekeeper, etc.).
 */
export function ShopModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Track WHICH item is checking out so only its button shows the loading
  // state; the rest stay normal-looking but disabled while one is in flight.
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  // Which add-on flip card is currently showing its back (power description).
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const { entitlements, entitlementsLoading } = useAuth();

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
    setLoadingItemId(itemId);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("يرجى تسجيل الدخول أولاً.");
        setLoadingItemId(null);
        return;
      }

      const resp = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ itemId }),
      });
      if (!resp.ok) throw new Error(`checkout failed: ${resp.status}`);

      const { url } = (await resp.json()) as { url?: string };
      if (!url) throw new Error("missing checkout url");

      // Navigate to Stripe-hosted Checkout (no reset — we leave the page).
      window.location.href = url;
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

  // Each add-on is a flip card: front shows icon/name/price, back reveals the
  // role's in-game power plus the Buy button. Colors + descriptions mirror the
  // expansion roles shown in the game guide.
  const addOns = [
    { id: "role_wizard", title: "دور الساحر", role: "الساحر", color: "#84CC16", desc: "يملك جرعة حياة لإنقاذ ضحية المافيا، وجرعة سم للتخلص من أي لاعب." },
    { id: "role_madman", title: "دور المجنون", role: "المجنون", color: "#E879F9", desc: "لاعب مستقل، هدفه إقناع المجلس بالتصويت ضده وإعدامه في النهار ليفوز وحده وتخسر القرية." },
    { id: "role_avenger", title: "دور المنتقم", role: "المنتقم", color: "#F59E0B", desc: "قروي يملك فرصة للرد، إذا قُتل أو أُعدم يختار لاعباً ليأخذه معه للقبر." },
    { id: "role_twins", title: "دور التوأم", role: "التوأم", color: "#22D3EE", desc: "قرويان يثقان ببعضهما ويظهران لبعضهما بالليلة الأولى، وإذا مات أحدهما مات الآخر حزناً." },
  ];

  return (
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
          <h2 className="text-xl font-black text-white">باقات قناع</h2>
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
              تجربة اللعبة لمرتين مجاناً بالأدوار الأساسية فقط لاستكشاف الأجواء.
            </p>
            {entitlementsLoading ? (
              checkingBadge
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
              لعب غير محدود للأدوار الرئيسية للأبد.
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
              <span className="flex items-center gap-1.5 text-base font-black" style={{ color: "#FBBF24" }}>
                الباقة الشاملة <span>👑</span>
              </span>
              <span className="text-2xl font-black" style={{ color: "#FBBF24" }}>
                29.99 <span className="text-base font-bold">ر.س</span>
              </span>
            </div>
            <div style={{ height: "1px", backgroundColor: "rgba(245,158,11,0.22)" }} />
            <p className="text-sm leading-relaxed flex-1" style={{ color: "#D4B97A" }}>
              كل الأدوار الحالية والمستقبلية.
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
          {addOns.map(({ id, title, role, color, desc }) => {
            const flipped = flippedId === id;
            // All-Access cascades to every add-on; otherwise the role must be in
            // the user's purchased owned_items list.
            const owned = hasAll || (entitlements?.owned_items?.includes(id) ?? false);
            return (
              <div key={id} dir="rtl" className="h-52 [perspective:1200px]">
                <div
                  className="relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d]"
                  style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>

                  {/* ── Front ── icon / name / price */}
                  <button
                    type="button"
                    onClick={() => setFlippedId(id)}
                    aria-pressed={flipped}
                    aria-label={`عرض قدرة ${role}`}
                    className="absolute inset-0 [backface-visibility:hidden] rounded-2xl p-5 flex flex-col items-center justify-center gap-3 text-center transition-colors duration-200 active:scale-[0.98]"
                    style={{ backgroundColor: "#0D0D0D", border: `1px solid ${color}33` }}>
                    <div style={{ filter: `drop-shadow(0 0 18px ${color}55)` }}>
                      <VenetianMask size={44} color={color} strokeWidth={1} />
                    </div>
                    <span className="text-base font-black" style={{ color }}>{title}</span>
                    {owned ? (
                      <span className="text-lg font-black" style={{ color: "#4ADE80" }}>مملوك ✓</span>
                    ) : (
                      <span className="text-lg font-black text-amber-400">7.99 ر.س</span>
                    )}
                    <span className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: "#777777" }}>
                      <RotateCw size={12} strokeWidth={2} />
                      اضغط لمعرفة القدرة
                    </span>
                  </button>

                  {/* ── Back ── power description + buy ── */}
                  <div
                    className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-2xl p-4 flex flex-col gap-2"
                    style={{ backgroundColor: "#0D0D0D", border: `1px solid ${color}55` }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black" style={{ color }}>{role}</span>
                      <button
                        type="button"
                        onClick={() => setFlippedId(null)}
                        aria-label="رجوع"
                        className="flex items-center justify-center w-7 h-7 rounded-full text-white/50 hover:text-white transition-colors active:scale-90"
                        style={{ backgroundColor: "#161616", border: "1px solid #2A2A2A" }}>
                        <ArrowLeft size={14} strokeWidth={2} />
                      </button>
                    </div>
                    <p className="flex-1 text-xs leading-relaxed text-right overflow-y-auto" style={{ color: "#AAAAAA" }}>
                      {desc}
                    </p>
                    {owned ? (
                      <div
                        className="w-full py-2 rounded-lg text-sm font-black text-center"
                        style={{
                          backgroundColor: "rgba(34,197,94,0.12)",
                          color: "#4ADE80",
                          border: "1px solid rgba(34,197,94,0.35)",
                        }}>
                        مملوك ✓
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
                        {loadingItemId === id ? "جارٍ التحويل…" : "شراء • 7.99 ر.س"}
                      </button>
                    )}
                  </div>

                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs" style={{ color: "#555555" }}>
          الأسعار قابلة للتغيير. تُعالَج المدفوعات عبر بوابة دفع آمنة.
        </p>
      </div>
    </div>
  );
}
