import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { entitlementsIncludePurchase, useAuth } from "../lib/auth";

/**
 * Captured at module load so return URLs are still available even if something
 * later calls history.replaceState and clears the query string.
 */
const INITIAL_PATH =
  typeof window !== "undefined" ? window.location.pathname : "";
const INITIAL_SEARCH =
  typeof window !== "undefined" ? window.location.search : "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handles the return from Tap hosted checkout.
 * Tap redirects to `/payment-success` after payment.
 */
export function CheckoutReturn() {
  const { loading, refreshAfterPurchase } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (loading || processed.current) return;

    const isTapSuccess =
      INITIAL_PATH.endsWith("/payment-success") ||
      INITIAL_PATH.endsWith("payment-success");

    const params = new URLSearchParams(INITIAL_SEARCH);
    const legacyStatus = params.get("checkout");
    const isLegacySuccess = legacyStatus === "success";

    if (!isTapSuccess && !isLegacySuccess && legacyStatus !== "cancel") return;

    processed.current = true;

    const liveParams = new URLSearchParams(window.location.search);
    liveParams.delete("checkout");
    liveParams.delete("session_id");

    if (isTapSuccess) {
      const base = window.location.pathname.replace(/\/?payment-success\/?$/, "") || "/";
      const query = liveParams.toString();
      const newUrl = base + (query ? `?${query}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    } else {
      const query = liveParams.toString();
      const newUrl =
        window.location.pathname +
        (query ? `?${query}` : "") +
        window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }

    if (legacyStatus === "cancel") {
      toast("أُلغيت عملية الدفع.");
      return;
    }

    void (async () => {
      let latest = await refreshAfterPurchase();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (entitlementsIncludePurchase(latest, "all_access")) break;
        await sleep(1000);
        latest = await refreshAfterPurchase();
      }

      toast.success("تم الشراء بنجاح", {
        description: entitlementsIncludePurchase(latest, "all_access")
          ? "تم تفعيل اشتراكك المميز."
          : "جارٍ تأكيد عملية الدفع…",
        duration: 6000,
      });
    })();
  }, [loading, refreshAfterPurchase]);

  return null;
}
