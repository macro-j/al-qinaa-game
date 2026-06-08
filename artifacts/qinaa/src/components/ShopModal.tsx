import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";

/**
 * Pricing / packages modal. Every "buy" button starts a Stripe Checkout for the
 * All-Access package (test phase — individual product mapping comes later). The
 * actual entitlement unlock happens server-side via the verified Stripe webhook.
 * Rendered globally via ShopProvider so it can be opened from anywhere
 * (footer button, entitlement gatekeeper, etc.).
 */
export function ShopModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleBuy = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("يرجى تسجيل الدخول أولاً.");
        setLoading(false);
        return;
      }

      const resp = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!resp.ok) throw new Error(`checkout failed: ${resp.status}`);

      const { url } = (await resp.json()) as { url?: string };
      if (!url) throw new Error("missing checkout url");

      // Navigate to Stripe-hosted Checkout (no setLoading reset — we leave the page).
      window.location.href = url;
    } catch (err) {
      console.error("Checkout error:", err);
      toast.error("تعذّر بدء عملية الدفع. حاول مرة أخرى.");
      setLoading(false);
    }
  };

  if (!open) return null;

  const addOns = ["دور الساحر", "دور المجنون", "دور المنتقم", "دور التوأم", "إزالة الإعلانات"];

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
            <div
              className="w-full text-center py-2.5 rounded-xl text-sm font-bold"
              style={{ backgroundColor: "#1A1A1A", color: "#666666", border: "1px solid #2A2A2A" }}>
              الباقة الحالية
            </div>
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
            <button
              type="button"
              onClick={handleBuy}
              disabled={loading}
              className="w-full text-center py-2.5 rounded-xl text-sm font-bold transition-all duration-150 hover:bg-neutral-700 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#1A1A1A", color: "#FFFFFF", border: "1px solid #333333" }}>
              {loading ? "جارٍ التحويل…" : "شراء"}
            </button>
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
              كل الأدوار الحالية والمستقبلية + إزالة الإعلانات.
            </p>
            <button
              type="button"
              onClick={handleBuy}
              disabled={loading}
              className="w-full text-center py-2.5 rounded-xl text-sm font-black transition-all duration-150 hover:brightness-110 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#F59E0B", color: "#1A1206" }}>
              {loading ? "جارٍ التحويل…" : "احصل عليها"}
            </button>
          </div>

        </div>

        {/* ── A-la-carte add-ons ── */}
        <div className="w-full h-px bg-neutral-800 my-6"></div>
        <h4 className="text-white font-bold mb-4 text-right">الإضافات المفردة (تتطلب اللعبة الأساسية)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {addOns.map((title) => (
            <div
              key={title}
              dir="rtl"
              className="bg-neutral-900/40 border border-neutral-800/60 rounded-xl p-3.5 flex flex-col gap-3">
              <div className="flex justify-between items-center gap-3">
                <span className="text-sm font-bold text-white text-right">{title}</span>
                <span className="text-sm font-black text-amber-400 shrink-0">7.99 ر.س</span>
              </div>
              <button
                type="button"
                onClick={handleBuy}
                disabled={loading}
                className="w-full py-2 rounded-lg text-sm font-black text-amber-400 transition-all duration-150 hover:bg-amber-400 hover:text-neutral-950 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.35)",
                }}>
                {loading ? "جارٍ التحويل…" : "شراء"}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs" style={{ color: "#555555" }}>
          الأسعار قابلة للتغيير. تُعالَج المدفوعات عبر بوابة دفع آمنة.
        </p>
      </div>
    </div>
  );
}
