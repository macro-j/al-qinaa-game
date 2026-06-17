import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { getValidAccessToken } from "../lib/supabase";
import { useAuth } from "../lib/auth";
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
  const { refreshEntitlements } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const params = new URLSearchParams(INITIAL_SEARCH);
    const status = params.get("checkout");
    if (!status) return;

    const sessionId = params.get("session_id");
    handled.current = true;

    // Strip the params so a refresh doesn't re-trigger this flow. We rebuild the
    // query from the CURRENT url (not INITIAL_SEARCH) in case other params were
    // added meanwhile, then drop only the checkout ones.
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

      // Authoritative, synchronous confirmation via our server.
      try {
        const token = await getValidAccessToken();
        if (token && sessionId) {
          const { resp, data } = await apiPost(
            "/api/checkout/verify",
            { sessionId },
            { Authorization: `Bearer ${token}` },
          );
          if (!resp.ok) {
            console.error("Checkout verify failed:", resp.status, data);
          }
          confirmed = resp.ok;
        }
      } catch (err) {
        console.error("Checkout verify error:", err);
      }

      // Highly visible success toast. We show it whenever we returned from a
      // successful checkout; on a confirmed 200 the entitlement is already
      // granted, otherwise the verified webhook finishes the job moments later.
      toast.success("تم الشراء بنجاح", {
        description: confirmed
          ? "تم تفعيل مشترياتك."
          : "جارٍ تفعيل مشترياتك…",
        duration: 6000,
      });

      // Pull the (now-updated) entitlements, with a short fallback poll.
      let tries = 0;
      const poll = async () => {
        await refreshEntitlements();
        tries += 1;
        if (tries < 5) setTimeout(poll, 2000);
      };
      await poll();
    })();
  }, [refreshEntitlements]);

  return null;
}
