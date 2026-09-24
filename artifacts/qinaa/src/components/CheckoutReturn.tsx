import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiPostAuthenticated } from "../lib/api";
import { entitlementsIncludePurchase, useAuth } from "../lib/auth";

/** Captured at module load so legacy Paylink callback values survive cleanup. */
const INITIAL_PATH =
  typeof window !== "undefined" ? window.location.pathname : "";
const INITIAL_SEARCH =
  typeof window !== "undefined" ? window.location.search : "";
const NALPAY_PENDING_KEY = "qinaa.pendingNalpayPayment";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type VerifyResponse = {
  unlocked?: boolean;
  status?: string;
  itemId?: string;
  error?: string;
};

type PendingNalpayPayment = {
  paymentId: string;
  itemId: string;
  createdAt: number;
};

const PURCHASE_LABELS: Record<string, string> = {
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

function readPendingNalpayPayment(): PendingNalpayPayment | null {
  try {
    const raw = sessionStorage.getItem(NALPAY_PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingNalpayPayment>;
    if (
      typeof value.paymentId !== "string" ||
      typeof value.itemId !== "string" ||
      typeof value.createdAt !== "number"
    ) {
      sessionStorage.removeItem(NALPAY_PENDING_KEY);
      return null;
    }
    // NalPay links expire after 30 minutes; retain a wider window so a delayed
    // webhook/return can still refresh the entitlement without stale storage.
    if (Date.now() - value.createdAt > 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(NALPAY_PENDING_KEY);
      return null;
    }
    return value as PendingNalpayPayment;
  } catch {
    sessionStorage.removeItem(NALPAY_PENDING_KEY);
    return null;
  }
}

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

async function showConfirmedPurchase(
  verification: VerifyResponse,
  refreshAfterPurchase: ReturnType<typeof useAuth>["refreshAfterPurchase"],
): Promise<void> {
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
}

/**
 * Verifies both the current NalPay hosted-link flow and legacy Paylink returns.
 * Neither a browser return nor local storage is proof of payment: the API
 * retrieves the gateway object before granting an entitlement.
 */
export function CheckoutReturn() {
  const { loading, user, refreshAfterPurchase } = useAuth();
  const processing = useRef(false);
  const legacyProcessed = useRef(false);
  const lastNalpayAttemptAt = useRef(0);
  const [checkRequest, setCheckRequest] = useState(0);

  useEffect(() => {
    const requestCheck = () => setCheckRequest((value) => value + 1);
    const onVisibility = () => {
      if (document.visibilityState === "visible") requestCheck();
    };
    window.addEventListener("pageshow", requestCheck);
    window.addEventListener("focus", requestCheck);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", requestCheck);
      window.removeEventListener("focus", requestCheck);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (loading || processing.current) return;

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
    const hasLegacyReturn =
      !legacyProcessed.current && (isPaylinkSuccess || isPaylinkCancel);
    const pendingNalpay = readPendingNalpayPayment();

    if (!hasLegacyReturn && !pendingNalpay) return;
    if (
      !hasLegacyReturn &&
      Date.now() - lastNalpayAttemptAt.current < 3_000
    ) {
      return;
    }
    processing.current = true;

    void (async () => {
      if (hasLegacyReturn) {
        legacyProcessed.current = true;
        cleanPaymentParams(isSuccessPath);
        if (isPaylinkCancel) {
          toast("أُلغيت عملية الدفع ولم يُخصم شيء.");
          return;
        }
        if (!user) {
          toast.error(
            "سجّل الدخول بالحساب الذي بدأ عملية الشراء للتحقق من الدفع.",
          );
          return;
        }
        if (!orderNumber || !transactionNo) {
          toast.error("تعذّر التحقق من العملية لعدم اكتمال بيانات الدفع.");
          return;
        }
        let verification: VerifyResponse | null = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const { resp, data } = await apiPostAuthenticated<VerifyResponse>(
            "/api/payment/paylink-verify",
            { orderNumber, transactionNo },
          );
          if (!resp || !resp.ok) {
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
        if (
          verification?.status?.toLowerCase() === "paid" &&
          verification.unlocked === true
        ) {
          await showConfirmedPurchase(verification, refreshAfterPurchase);
        } else if (verification?.status?.toLowerCase() === "pending") {
          toast("تم استلام العملية وهي قيد التأكيد.");
        } else {
          toast.error("لم تكتمل عملية الدفع، ولم يتم تفعيل أي عنصر.");
        }
        return;
      }

      if (!pendingNalpay) return;
      lastNalpayAttemptAt.current = Date.now();
      if (!user) {
        toast.error(
          "سجّل الدخول بالحساب الذي بدأ عملية الشراء للتحقق من الدفع.",
        );
        return;
      }
      const { resp, data } = await apiPostAuthenticated<VerifyResponse>(
        "/api/payment/nalpay-verify",
        { paymentId: pendingNalpay.paymentId },
      );
      if (!resp || !resp.ok) {
        console.error("NalPay verification failed:", resp?.status, data);
        if (!resp || resp.status === 401) {
          toast.error("انتهت جلسة الدخول. سجّل الدخول ثم حاول مرة أخرى.");
        } else {
          toast("تعذّر التحقق الآن؛ سنحاول مجددًا عند عودتك للتطبيق.");
        }
        return;
      }
      const status = data.status?.toLowerCase();
      if (status === "paid" && data.unlocked === true) {
        sessionStorage.removeItem(NALPAY_PENDING_KEY);
        await showConfirmedPurchase(data, refreshAfterPurchase);
      } else if (["canceled", "expired", "failed", "refunded"].includes(status ?? "")) {
        sessionStorage.removeItem(NALPAY_PENDING_KEY);
        toast.error("لم تكتمل عملية الدفع، ولم يتم تفعيل أي عنصر.");
      } else {
        toast("عملية الدفع ما زالت بانتظار التأكيد.", {
          description: "أكمل الدفع في صفحة NalPay ثم عد إلى التطبيق.",
          duration: 5000,
        });
      }
    })()
      .catch((error) => {
        console.error("Payment return handling failed:", error);
        toast.error("تعذّر التحقق من عملية الدفع. حاول تحديث الصفحة لاحقًا.");
      })
      .finally(() => {
        processing.current = false;
      });
  }, [checkRequest, loading, user, refreshAfterPurchase]);

  return null;
}
