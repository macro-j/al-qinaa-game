import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { fulfillCheckoutSession } from "../lib/stripeFulfillment";

/**
 * Stripe webhook endpoint handler. Must be mounted with express.raw() so
 * signature verification receives the raw body buffer.
 */
export async function handleStripeWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const sigHeader = req.headers["stripe-signature"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    req.log.error("Stripe webhook missing signature or STRIPE_WEBHOOK_SECRET");
    res.status(400).json({ error: "bad_request" });
    return;
  }

  if (!Buffer.isBuffer(req.body)) {
    req.log.error(
      "Stripe webhook body is not a Buffer — express.json() ran before this route",
    );
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = await getUncachableStripeClient();
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    req.log.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "invalid_signature" });
    return;
  }

  req.log.info(
    { eventId: event.id, eventType: event.type },
    "Stripe webhook received and verified",
  );

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await fulfillCheckoutSession(session, req.log);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    req.log.error({ err, eventId: event.id }, "Stripe webhook fulfillment failed");
    res.status(500).json({ error: "fulfillment_failed" });
  }
}
