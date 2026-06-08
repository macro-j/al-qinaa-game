import { Router, type IRouter } from "express";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getAllAccessPriceId } from "../lib/stripeProducts";
import { getUserFromToken } from "../lib/supabase";

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
      success_url: `${base}/?checkout=success`,
      cancel_url: `${base}/?checkout=cancel`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Failed to create Stripe checkout session");
    return res.status(500).json({ error: "checkout_failed" });
  }
});

export default router;
