import type { Logger } from "pino";
import type Stripe from "stripe";
import {
  activatePremiumProfile,
  completePaymentByGatewayOrderId,
  grantSpecificEntitlement,
} from "./supabase";

export function extractCheckoutUserId(
  session: Stripe.Checkout.Session,
): string | null {
  return (
    session.metadata?.user_id ??
    session.metadata?.supabase_user_id ??
    session.client_reference_id ??
    null
  );
}

/**
 * Fulfillment pipeline for a paid Checkout session:
 *  1. payments.status → completed
 *  2. profiles.is_premium → true
 *  3. user_entitlements via grant_specific_entitlement (when item_id present)
 */
export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
  log: Logger,
): Promise<void> {
  const userId = extractCheckoutUserId(session);
  const itemId = session.metadata?.item_id ?? null;
  const sessionId = session.id;

  if (session.payment_status !== "paid") {
    log.warn(
      { paymentStatus: session.payment_status, sessionId, userId },
      "checkout.session.completed skipped: session not paid",
    );
    return;
  }

  if (!userId) {
    log.warn(
      { sessionId, metadata: session.metadata },
      "checkout.session.completed skipped: missing user_id in metadata",
    );
    return;
  }

  const paymentsUpdated = await completePaymentByGatewayOrderId(sessionId);
  if (paymentsUpdated === 0) {
    log.warn(
      { sessionId, userId },
      "No payments row matched gateway_order_id — status not updated",
    );
  } else {
    log.info({ sessionId, userId, paymentsUpdated }, "Payment marked completed");
  }

  // One-time Checkout items → lifetime premium (no expiry).
  await activatePremiumProfile(userId, null);
  log.info({ userId }, "Profile marked premium");

  if (itemId) {
    await grantSpecificEntitlement(userId, itemId);
    log.info({ userId, itemId }, "Granted game entitlement");
  }
}
