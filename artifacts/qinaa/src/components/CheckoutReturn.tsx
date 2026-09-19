import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { apiPostAuthenticated } from "../lib/api";
import { entitlementsIncludePurchase, useAuth } from "../lib/auth";

/**
 * Captured at module load so Paylink's callback values survive URL cleanup.
 */
const INITIAL_PATH =
  typeof window !== "undefined" ? window.location.pathname : "";
const INITIAL_SEARCH =
  typeof window !== "undefined" ? window.location.search : "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PaylinkVerifyResponse = {
  unlocked?: boolean;
  status?: "paid" | "pending" | "canceled" | string;
  itemId?: string;
  error?: string;
};

const PURCHASE_LABELS: Record<string, string> = {
  base_game: "اللعبة الأساسية",
  all_access: "الباقة الشاملة",
  role_wizard: "دور الساحر",
  role_madman: "دور المجنون",
  role_avenger: "دور المنتقم",
  role_twins: "دور التوأم",
  role_sniper: "دور القناص",
};

function getParamIgnoreCase(
  params: URLSearchParams,
  expectedName: string,
): string | null {
  const expected = expectedName.toLowerCase();
  for (const [name, value] of params.entries()) {
    if (name.toLowerCase() === expected) return value;
  }
  return null;
}

function cleanPaymentParams(isSuccessPath: boolean): void {
  const params = new URLSearchParams(window.location.search);
  const paymentKeys = new Set([
    "gateway",
    "checkout",
    "ordernumber",
    "transactionno",
  ]);

  for (const name of Array.from(params.keys())) {
    if (paymentKeys.has(name.toLowerCase())) params.delete(name);
  }

  const path = isSuccessPath
    ? window.location.pathname.replace(/\/?payment-success\/?$/, "") || "/"
    : window.location.pathname;
  const query = params.toString();
  window.history.replaceState(
    {},
    "",
    path + (query ? `?${query}` : "") + window.location.hash,
  );
}

/**
 * Handles the verified return from Paylink's hosted invoice page. A callback
 * URL by itself is never considered proof of payment: the server re-fetches
 * the invoice from Paylink before granting the exact purchased item.
 */
export function CheckoutReturn() {
  const { loading, user, refreshAfterPurchase } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (loading || processed.current) return;

    const params = new URLSearchParams(INITIAL_SEARCH);
    const gateway = getParamIgnoreCase(params, "gateway")?.toLowerCase();
    const checkout = getParamIgnoreCase(params, "checkout")?.toLowerCase();
    const orderNumber = getParamIgnoreCase(params, "OrderNumber");
    const transactionNo = getParamIgnoreCase(params, "TransactionNo");
    const isSuccessPath = /\/?payment-success\/?$/.test(INITIAL_PATH);
    const isPaylinkCancel = gateway === "paylink" && checkout === "cancel";
    const isPaylinkSuccess =
      isSuccessPath &&
      (gateway === "paylink" || (!!orderNumber && !!transactionNo));

    if (!isPaylinkSuccess && !isPaylinkCancel) return;
    processed.current = true;
    cleanPaymentParams(isSuccessPath);

    if (isPaylinkCancel) {
      toast("أُلغيت عملية الدفع ولم يُخصم شيء.");
      return;
    }

    if (!user) {
      toast.error("سجّل الدخول بالحساب الذي بدأ عملية الشراء للتحقق من الدفع.");
      return;
    }

    if (!orderNumber || !transactionNo) {
      toast.error("تعذّر التحقق من العملية لعدم اكتمال بيانات الدفع.");
      return;
    }

    void (async () => {
      let verification: PaylinkVerifyResponse | null = null;

      // Paylink can redirect a fraction before its payment state is final.
      // Re-verification is server-authoritative and safe to repeat.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { resp, data } = await apiPostAuthenticated<PaylinkVerifyResponse>(
          "/api/payment/paylink-verify",
          { orderNumber, transactionNo },
        );

        if (!resp || !resp.ok) {
          console.error("Paylink verification failed:", resp?.status, data);
          toast.error(
            !resp || resp.status === 401
              ? "انتهت جلسة الدخول. سجّل الدخول ثم حاول مرة أخرى."
              : "تعذّر التحقق من عملية الدفع. لم يتم تفعيل أي عنصر.",
          );
          return;
        }

        verification = data;
        if (data.status?.toLowerCase() !== "pending") break;
        if (attempt < 3) await sleep(1500);
      }

      const status = verification?.status?.toLowerCase();

      if (status === "canceled" || status === "cancelled") {
        toast("أُلغيت عملية الدفع ولم يتم تفعيل أي عنصر.");
        return;
      }

      if (status === "pending") {
        toast("تم استلام العملية وهي قيد التأكيد.", {
          description: "سيظهر العنصر في حسابك بعد تأكيد الدفع.",
          duration: 7000,
        });
        return;
      }

      if (status !== "paid" || verification?.unlocked !== true) {
        toast.error("لم تكتمل عملية الدفع، ولم يتم تفعيل أي عنصر.");
        return;
      }

      const itemId =
        typeof verification.itemId === "string" ? verification.itemId : null;
      let latest = await refreshAfterPurchase();

      if (itemId) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          if (entitlementsIncludePurchase(latest, itemId)) break;
          await sleep(750);
          latest = await refreshAfterPurchase();
        }
      }

      const entitlementVisible = itemId
        ? entitlementsIncludePurchase(latest, itemId)
        : false;
      toast.success("تم الدفع بنجاح", {
        description: entitlementVisible
          ? `تم تفعيل ${PURCHASE_LABELS[itemId!] ?? "مشترياتك"}.`
          : "تم تأكيد الدفع، ويجري تحديث مشتريات حسابك.",
        duration: 6500,
      });
    })().catch((error) => {
      console.error("Paylink return handling failed:", error);
      toast.error("تعذّر التحقق من عملية الدفع. حاول تحديث الصفحة لاحقًا.");
    });
  }, [loading, user, refreshAfterPurchase]);

  return null;
}
