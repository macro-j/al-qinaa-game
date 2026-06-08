import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";

/**
 * Handles the return from Stripe Checkout. Stripe redirects back to
 * `/?checkout=success` (or `=cancel`). On success we show a toast and poll
 * entitlements a few times — the actual unlock happens server-side via the
 * verified webhook, which may land a moment after the redirect.
 */
export function CheckoutReturn() {
  const { refreshEntitlements } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;

    const params = new URLSearchParams(window.location.search);
    const status = params.get("checkout");
    if (!status) return;

    handled.current = true;

    // Strip the param so a refresh doesn't re-trigger the toast.
    params.delete("checkout");
    const query = params.toString();
    const newUrl =
      window.location.pathname +
      (query ? `?${query}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", newUrl);

    if (status === "success") {
      toast.success("تم الدفع بنجاح! جارٍ تفعيل الباقة الشاملة…");
      let tries = 0;
      const poll = async () => {
        await refreshEntitlements();
        tries += 1;
        if (tries < 5) setTimeout(poll, 2000);
      };
      void poll();
    } else if (status === "cancel") {
      toast("أُلغيت عملية الدفع.");
    }
  }, [refreshEntitlements]);

  return null;
}
