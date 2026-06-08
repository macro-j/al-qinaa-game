import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

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

    const params = new URLSearchParams(window.location.search);
    const status = params.get("checkout");
    if (!status) return;

    const sessionId = params.get("session_id");
    handled.current = true;

    // Strip the params so a refresh doesn't re-trigger this flow.
    params.delete("checkout");
    params.delete("session_id");
    const query = params.toString();
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
      toast.success("تم الدفع بنجاح! جارٍ تفعيل الباقة الشاملة…");

      // Authoritative, synchronous confirmation via our server.
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token && sessionId) {
          await fetch("/api/checkout/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ sessionId }),
          });
        }
      } catch (err) {
        console.error("Checkout verify error:", err);
      }

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
