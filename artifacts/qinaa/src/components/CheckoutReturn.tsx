import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { getValidAccessToken } from "../lib/supabase";
import {
  entitlementsIncludePurchase,
  useAuth,
} from "../lib/auth";
import { apiPost } from "../lib/api";

/**
 * The checkout params, captured at MODULE LOAD — the instant the bundle runs,
 * before React renders or supabase's `detectSessionInUrl` runs. This guarantees
 * we still have `?checkout=success&session_id=...` even if something later calls
 * history.replaceState and clears the query (which was swallowing the success
 * toast before).
 */
const INITIAL_SEARCH =
  typeof window !== "undefined" ? window.location.search : "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handles the return from Stripe Checkout. Stripe redirects back to
 * `/?checkout=success&session_id=...` (or `?checkout=cancel`).
 *
 * On success we synchronously VERIFY the payment with our server (which checks
 * the session straight from Stripe and grants the entitlement) and then refresh
 * the local entitlement state. This does not depend on the async webhook being
 * delivered, so the unlock is reliable and immediate. We still poll a couple of
 * times as a fallback in case the webhook lands first.
 */
export function CheckoutReturn() {
  const { loading, refreshAfterPurchase } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (loading || processed.current) return;

    const params = new URLSearchParams(INITIAL_SEARCH);
    const status = params.get("checkout");
    if (!status) return;

    const sessionId = params.get("session_id");
    processed.current = true;

    // Strip the params so a refresh doesn't re-trigger this flow.
    const liveParams = new URLSearchParams(window.location.search);
    liveParams.delete("checkout");
    liveParams.delete("session_id");
    const query = liveParams.toString();
    const newUrl =
      window.location.pathname +
      (query ? `?${query}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", newUrl);

    if (status === "cancel") {
      toast("أُلغيت عملية الدفع.");
      return;
    }

    if (status !== "success") return;

    void (async () => {
      let confirmed = false;
      let purchasedItemId: string | null = null;

      try {
        const token = await getValidAccessToken();
        if (token && sessionId) {
          const { resp, data } = await apiPost<{
            unlocked?: boolean;
            itemId?: string | null;
            error?: string;
          }>(
            "/api/checkout/verify",
            { sessionId },
            { Authorization: `Bearer ${token}` },
          );

          if (!resp.ok) {
            console.error("Checkout verify failed:", resp.status, data);
          } else {
            confirmed = data.unlocked === true;
            purchasedItemId =
              typeof data.itemId === "string" ? data.itemId : null;
          }
        }
      } catch (err) {
        console.error("Checkout verify error:", err);
      }

      // Re-fetch entitlements + profile from Supabase until the purchase shows up.
      let latest = await refreshAfterPurchase();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (entitlementsIncludePurchase(latest, purchasedItemId)) break;
        await sleep(1000);
        latest = await refreshAfterPurchase();
      }

      toast.success("تم الشراء بنجاح", {
        description: entitlementsIncludePurchase(latest, purchasedItemId)
          ? "تم تفعيل مشترياتك."
          : confirmed
            ? "جارٍ تفعيل مشترياتك…"
            : "جارٍ تأكيد عملية الدفع…",
        duration: 6000,
      });
    })();
  }, [loading, refreshAfterPurchase]);

  return null;
}
