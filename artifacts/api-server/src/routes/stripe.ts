import { Router, type IRouter } from "express";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getAllAccessPriceId } from "../lib/stripeProducts";
import { getUserFromToken, unlockAllAccess } from "../lib/supabase";

const router: IRouter = Router();

function publicBaseUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) {
    throw new Error("REPLIT_DOMAINS is not set; cannot build checkout return URLs.");
  }
  return `https://${domain}`;
}

/**
 * Creates a Stripe Checkout Session for the All-Access package.
 * Requires a valid Supabase access token (Bearer) so the buyer is identified
 * server-side — the resulting session carries that uid for webhook fulfillment.
 */
router.post("/checkout", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
    if (!token) {
      return res.status(401).json({ error: "missing_auth_token" });
    }

    let user: Awaited<ReturnType<typeof getUserFromToken>>;
    try {
      user = await getUserFromToken(token);
    } catch (authErr) {
      req.log.warn({ err: authErr }, "Rejected checkout: invalid Supabase token");
      return res.status(401).json({ error: "invalid_auth_token" });
    }

    const stripe = await getUncachableStripeClient();
    const priceId = await getAllAccessPriceId(stripe);
    const base = publicBaseUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
      customer_email: user.email ?? undefined,
      success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?checkout=cancel`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Failed to create Stripe checkout session");
    return res.status(500).json({ error: "checkout_failed" });
  }
});

/**
 * Synchronous fulfillment safety net. Called by the client when it returns from
 * Checkout with a `session_id`. We retrieve the session straight from Stripe
 * (authoritative), confirm it is paid AND belongs to the requesting user, then
 * grant access. This makes fulfillment reliable even if the async webhook is
 * delayed or undelivered (e.g. the dev server was asleep). The grant RPC is
 * idempotent, so it is safe to run alongside the webhook.
 */
router.post("/checkout/verify", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
    if (!token) {
      return res.status(401).json({ error: "missing_auth_token" });
    }

    let user: Awaited<ReturnType<typeof getUserFromToken>>;
    try {
      user = await getUserFromToken(token);
    } catch (authErr) {
      req.log.warn({ err: authErr }, "Rejected verify: invalid Supabase token");
      return res.status(401).json({ error: "invalid_auth_token" });
    }

    const sessionId =
      typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
    if (!sessionId) {
      return res.status(400).json({ error: "missing_session_id" });
    }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const sessionUser =
      session.metadata?.supabase_user_id ?? session.client_reference_id ?? null;
    if (sessionUser !== user.id) {
      req.log.warn(
        { sessionUser, requestUser: user.id, sessionId },
        "Rejected verify: session does not belong to requesting user",
      );
      return res.status(403).json({ error: "session_user_mismatch" });
    }

    if (session.payment_status === "paid") {
      await unlockAllAccess(user.id);
      req.log.info(
        { userId: user.id, sessionId },
        "Verified checkout on return — granted All-Access",
      );
      return res.json({ unlocked: true });
    }

    req.log.info(
      { userId: user.id, sessionId, paymentStatus: session.payment_status },
      "Verify on return: session not paid yet",
    );
    return res.json({ unlocked: false, payment_status: session.payment_status });
  } catch (err) {
    req.log.error({ err }, "Checkout verify failed");
    return res.status(500).json({ error: "verify_failed" });
  }
});

export default router;
