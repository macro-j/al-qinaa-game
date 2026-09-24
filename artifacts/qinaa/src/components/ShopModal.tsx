import { useState, type FormEvent } from "react";
import {
  COUNCIL_PACK_ITEM_IDS,
  QINAA_CATALOG,
  ROLE_ITEM_IDS,
  formatSarAmount,
  resolveQinaaOffer,
  type PurchaseItemId,
} from "@workspace/qinaa-rules";
import { Crown, Sparkles, Ticket, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { getRoleName } from "../lib/roles";
import { RoleRevealCard } from "./RoleRevealCard";
import { AuthModal } from "./AuthModal";
import { apiPostAuthenticated } from "../lib/api";

const ROLE_CARDS: { id: (typeof ROLE_ITEM_IDS)[number]; roleKey: string }[] = [
  { id: "role_wizard", roleKey: "magician" },
  { id: "role_madman", roleKey: "madman" },
  { id: "role_avenger", roleKey: "avenger" },
  { id: "role_twins", roleKey: "twin" },
  { id: "role_sniper", roleKey: "sniper" },
];

const COUNCIL_LABELS: Record<(typeof COUNCIL_PACK_ITEM_IDS)[number], string> = {
  councils_5: "سهرة صغيرة",
  councils_15: "باقة السهرات",
  councils_40: "باقة المضيف",
};

const PURCHASE_LABELS: Record<PurchaseItemId, string> = {
  councils_5: "5 مجالس",
  councils_15: "15 مجلسًا",
  councils_40: "40 مجلسًا",
  roles_bundle: "مجموعة الأقنعة",
  full_bundle: "الباقة الشاملة",
  role_wizard: "قناع الساحر",
  role_madman: "قناع المجنون",
  role_avenger: "قناع المنتقم",
  role_twins: "قناع التوأم",
  role_sniper: "قناع القناص",
};

function normalizeSaudiMobile(value: string): string {
  const latinDigits = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  const compact = latinDigits.replace(/[\s()+-]/g, "");
  return compact.startsWith("9665") ? `0${compact.slice(3)}` : compact;
}

function isValidSaudiMobile(value: string): boolean {
  return /^05\d{8}$/.test(value);
}

function checkoutErrorMessage(error?: string): string {
  switch (error) {
    case "already_owned":
      return "هذا القناع مملوك في حسابك بالفعل.";
    case "bundle_not_available":
      return "استخدم عرض إكمال المجموعة المخصص لحسابك.";
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
      return "بوابة الدفع غير متاحة حاليًا.";
    case "payment_in_progress":
      return "هناك عملية دفع مفتوحة لهذا المنتج. أكمِلها ثم عد للتطبيق.";
    default:
      return "تعذّر بدء عملية الدفع. حاول مرة أخرى.";
  }
}

function PriceButton({
  itemId,
  amount,
  loadingItemId,
  busy,
  onBuy,
  label = "شراء",
}: {
  itemId: PurchaseItemId;
  amount: number;
  loadingItemId: string | null;
  busy: boolean;
  onBuy: (itemId: PurchaseItemId) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onBuy(itemId)}
      disabled={busy}
      className="w-full rounded-xl py-3 text-sm font-black transition-all active:scale-[0.98] disabled:opacity-60"
      style={{ backgroundColor: "#F59E0B", color: "#171006" }}
    >
      {loadingItemId === itemId
        ? "جارٍ فتح الدفع…"
        : `${label} • ${formatSarAmount(amount)} ر.س`}
    </button>
  );
}

export function ShopModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [checkoutItemId, setCheckoutItemId] = useState<PurchaseItemId | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientMobile, setClientMobile] = useState("");
  const { user, entitlements, entitlementsLoading, refreshEntitlements } = useAuth();

  const ownedItems = entitlements?.owned_items ?? [];
  const ownedRoleCount = ROLE_ITEM_IDS.filter((id) => ownedItems.includes(id)).length;
  const credits = entitlements?.game_credits ?? 0;
  const busy = loadingItemId !== null;
  const rolesOffer = resolveQinaaOffer("roles_bundle", ownedItems);
  const fullOffer = resolveQinaaOffer("full_bundle", ownedItems);

  const handleBuy = (itemId: PurchaseItemId) => {
    if (busy) return;
    if (!user) {
      setShowAuth(true);
      return;
    }
    const offer = resolveQinaaOffer(itemId, ownedItems);
    if (!offer) {
      toast.error(checkoutErrorMessage(itemId === "full_bundle" ? "bundle_not_available" : "already_owned"));
      return;
    }

    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const suggestedName = [metadata.full_name, metadata.name, metadata.display_name].find(
      (value): value is string => typeof value === "string" && value.trim().length >= 2,
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
      toast.error("اكتب رقمًا سعوديًا بصيغة 05xxxxxxxx.");
      return;
    }

    setLoadingItemId(checkoutItemId);
    try {
      const { resp, data } = await apiPostAuthenticated<{
        checkoutUrl?: string;
        paymentId?: string;
        error?: string;
      }>("/api/payment/nalpay-link", {
        itemId: checkoutItemId,
        clientName: normalizedName,
        clientMobile: normalizedMobile,
      });

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
        console.error("NalPay checkout failed:", resp?.status, data);
        toast.error(checkoutErrorMessage(authFailed ? "invalid_auth_token" : data.error));
        return;
      }

      if (typeof data.checkoutUrl !== "string" || typeof data.paymentId !== "string") {
        throw new Error("missing_checkout_url");
      }
      const checkout = new URL(data.checkoutUrl);
      const trustedHost = checkout.hostname === "nalpay.io" || checkout.hostname.endsWith(".nalpay.io");
      if (checkout.protocol !== "https:" || !trustedHost) throw new Error("untrusted_checkout_url");

      sessionStorage.setItem(
        "qinaa.pendingNalpayPayment",
        JSON.stringify({ paymentId: data.paymentId, itemId: checkoutItemId, createdAt: Date.now() }),
      );

      // Do not create an about:blank popup. Mobile in-app browsers frequently
      // detach it while the API request is pending and leave the customer on a
      // white page. Same-tab navigation is reliable; Back returns to the game
      // and CheckoutReturn verifies the payment server-side.
      window.location.assign(checkout.toString());
    } catch (error) {
      console.error("Checkout error:", error);
      toast.error("تعذّر فتح صفحة الدفع. حاول مرة أخرى.");
    } finally {
      setLoadingItemId(null);
    }
  };

  if (!open) return null;

  const loadingBadge = entitlementsLoading ? (
    <span className="text-xs text-neutral-500">جارٍ التحقق…</span>
  ) : !entitlements && user ? (
    <button type="button" onClick={() => void refreshEntitlements()} className="text-xs font-bold text-red-300">
      تعذّر التحقق — أعد المحاولة
    </button>
  ) : null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-5"
        style={{ backgroundColor: "rgba(0,0,0,0.9)", backdropFilter: "blur(12px)" }}
        onClick={onClose}
      >
        <div
          dir="rtl"
          className="w-full max-w-5xl max-h-[92dvh] overflow-y-auto rounded-2xl p-5 sm:p-7 shadow-2xl"
          style={{ backgroundColor: "#101010", border: "1px solid rgba(255,255,255,0.09)" }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white">متجر القناع</h2>
              <p className="mt-1 text-sm text-neutral-400">اشحن مجالسك وامتلك الأقنعة بشكل دائم</p>
            </div>
            <button type="button" onClick={onClose} aria-label="إغلاق المتجر" className="w-10 h-10 rounded-full flex items-center justify-center text-neutral-400" style={{ backgroundColor: "#1A1A1A" }}>
              <X size={18} />
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4" style={{ backgroundColor: "#071713", border: "1px solid rgba(16,185,129,0.28)" }}>
            <div className="flex items-center gap-3">
              <Ticket size={24} color="#34D399" />
              <div>
                <p className="text-xs text-emerald-200/70">رصيدك الحالي</p>
                <p className="text-xl font-black text-emerald-300">{user ? `${credits} مجلس` : "سجّل الدخول لعرض الرصيد"}</p>
              </div>
            </div>
            <p className="max-w-md text-xs leading-6 text-neutral-400">
              يُخصم مجلس واحد بعد اكتمال الليلة الأولى. إعادة التحميل أو استكمال القيم نفسه لا تخصم مرة أخرى.
            </p>
            {loadingBadge}
          </div>

          <section className="mt-7">
            <div className="flex items-center gap-2 mb-4">
              <Ticket size={18} color="#F59E0B" />
              <h3 className="font-black text-white">اشحن مجالسك</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {COUNCIL_PACK_ITEM_IDS.map((id) => {
                const offer = resolveQinaaOffer(id, ownedItems)!;
                return (
                  <div key={id} className="rounded-2xl p-4 flex flex-col gap-3" style={{ backgroundColor: "#0B0B0B", border: id === "councils_15" ? "1px solid rgba(245,158,11,0.65)" : "1px solid #272727" }}>
                    <div>
                      <p className="text-sm font-black text-white">{COUNCIL_LABELS[id]}</p>
                      <p className="mt-1 text-2xl font-black text-amber-400">{offer.creditsGranted} <span className="text-sm">مجالس</span></p>
                    </div>
                    <PriceButton itemId={id} amount={offer.amount} loadingItemId={loadingItemId} busy={busy} onBuy={handleBuy} />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <Crown size={19} color="#FBBF24" />
              <h3 className="font-black text-white">أفضل قيمة</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fullOffer && (
                <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ backgroundColor: "#181205", border: "1px solid #F59E0B", boxShadow: "0 0 28px rgba(245,158,11,0.12)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-amber-300">الباقة الشاملة</p>
                      <p className="mt-1 text-sm leading-6 text-amber-100/65">جميع الأقنعة الحالية ملكية دائمة + 20 مجلسًا.</p>
                    </div>
                    <Sparkles size={23} color="#FBBF24" />
                  </div>
                  <PriceButton itemId="full_bundle" amount={fullOffer.amount} loadingItemId={loadingItemId} busy={busy} onBuy={handleBuy} label="ابدأ بكل شيء" />
                </div>
              )}

              <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ backgroundColor: "#0C0C0C", border: "1px solid #303030" }}>
                <div>
                  <p className="text-lg font-black text-white">{ownedRoleCount ? "أكمل مجموعة الأقنعة" : "مجموعة الأقنعة"}</p>
                  <p className="mt-1 text-sm leading-6 text-neutral-400">
                    {rolesOffer
                      ? `${rolesOffer.rolesGranted.length} أقنعة دائمة متبقية + ${rolesOffer.creditsGranted} مجالس هدية.`
                      : "جميع الأقنعة الحالية مملوكة في حسابك ✓"}
                  </p>
                </div>
                {rolesOffer ? (
                  <PriceButton itemId="roles_bundle" amount={rolesOffer.amount} loadingItemId={loadingItemId} busy={busy} onBuy={handleBuy} label="امتلك المجموعة" />
                ) : (
                  <div className="rounded-xl py-3 text-center text-sm font-black text-emerald-400" style={{ backgroundColor: "rgba(16,185,129,0.09)", border: "1px solid rgba(16,185,129,0.25)" }}>المجموعة مكتملة ✓</div>
                )}
              </div>
            </div>
          </section>

          <section className="mt-8">
            <h3 className="font-black text-white mb-2">الأقنعة المنفردة</h3>
            <p className="text-xs text-neutral-500 mb-4">كل قناع ملكية دائمة ويضيف مجلسين هدية إلى رصيدك.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {ROLE_CARDS.map(({ id, roleKey }) => {
                const owned = ownedItems.includes(id);
                const offer = resolveQinaaOffer(id, ownedItems);
                return (
                  <div key={id} className="flex flex-col gap-3">
                    <RoleRevealCard roleKey={roleKey} />
                    {owned ? (
                      <div className="rounded-xl py-2.5 text-center text-sm font-black text-emerald-400" style={{ backgroundColor: "rgba(16,185,129,0.09)", border: "1px solid rgba(16,185,129,0.28)" }}>
                        {getRoleName(roleKey)} • مملوك دائمًا ✓
                      </div>
                    ) : (
                      <PriceButton itemId={id} amount={offer!.amount} loadingItemId={loadingItemId} busy={busy} onBuy={handleBuy} label={`امتلك ${getRoleName(roleKey)}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <p className="mt-7 text-center text-xs leading-6 text-neutral-500">
            الأقنعة ملكية دائمة. عند انتهاء الرصيد تبقى محفوظة في حسابك وتعود للعمل فور شحن مجالس جديدة. جميع الدفعات مرة واحدة وليست اشتراكًا.
          </p>
        </div>
      </div>

      {showAuth && <div style={{ position: "relative", zIndex: 70 }}><AuthModal open={showAuth} onClose={() => setShowAuth(false)} /></div>}

      {checkoutItemId && (
        <div dir="rtl" className="fixed inset-0 z-[80] flex items-center justify-center px-4" style={{ backgroundColor: "rgba(0,0,0,0.86)", backdropFilter: "blur(10px)" }} onClick={() => { if (!busy) setCheckoutItemId(null); }}>
          <form onSubmit={startCheckout} onClick={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-4 shadow-2xl" style={{ backgroundColor: "#111", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-white">إكمال بيانات الدفع</h3>
                <p className="mt-1 text-xs text-neutral-400">{PURCHASE_LABELS[checkoutItemId]} عبر NalPay</p>
              </div>
              <button type="button" aria-label="إغلاق" disabled={busy} onClick={() => setCheckoutItemId(null)} className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-400" style={{ backgroundColor: "#1A1A1A" }}><X size={17} /></button>
            </div>

            <label className="flex flex-col gap-2 text-sm font-bold text-neutral-200">
              الاسم
              <input type="text" autoComplete="name" value={clientName} onChange={(event) => setClientName(event.target.value)} disabled={busy} maxLength={80} placeholder="الاسم المستخدم في الفاتورة" className="w-full rounded-xl px-3.5 py-3 text-white outline-none focus:border-amber-500" style={{ backgroundColor: "#080808", border: "1px solid #303030" }} />
            </label>
            <label className="flex flex-col gap-2 text-sm font-bold text-neutral-200">
              رقم الجوال السعودي
              <input dir="ltr" type="tel" inputMode="tel" autoComplete="tel" value={clientMobile} onChange={(event) => setClientMobile(event.target.value)} disabled={busy} maxLength={20} placeholder="05xxxxxxxx" className="w-full rounded-xl px-3.5 py-3 text-left text-white outline-none focus:border-amber-500" style={{ backgroundColor: "#080808", border: "1px solid #303030" }} />
            </label>
            <p className="text-[11px] leading-5 text-neutral-500">ستنتقل مباشرة إلى صفحة NalPay الآمنة. بعد إتمام الدفع اضغط رجوع للعودة إلى القناع وتحديث مشترياتك.</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" disabled={busy} onClick={() => setCheckoutItemId(null)} className="rounded-xl py-3 text-sm font-bold text-neutral-300" style={{ backgroundColor: "#1A1A1A", border: "1px solid #303030" }}>إلغاء</button>
              <button type="submit" disabled={busy} className="rounded-xl py-3 text-sm font-black text-neutral-950 disabled:opacity-60" style={{ backgroundColor: "#F59E0B" }}>{busy ? "جارٍ فتح الدفع…" : "المتابعة للدفع"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
