import { Router, type IRouter, type Response } from "express";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getCatalogItem } from "../lib/stripeProducts";
import { getSupabaseAdmin, getUserFromToken } from "../lib/supabase";
import {
  extractCheckoutUserId,
  fulfillCheckoutSession,
} from "../lib/stripeFulfillment";

const router: IRouter = Router();

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sendJson(res: Response, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) return;
  res
    .status(status)
    .type("application/json")
    .send(JSON.stringify(body));
}

function sendJsonError(
  res: Response,
  status: number,
  err: unknown,
  fallback: string,
): void {
  const message = errorMessage(err) || fallback;
  sendJson(res, status, { error: message });
}

function publicBaseUrl(req: { get(name: string): string | undefined }): string {
  const origin = req.get("origin");
  if (origin) return origin.replace(/\/+$/, "");

  const referer = req.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // ignore malformed referer
    }
  }

  const configured =
    process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.FRONTEND_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (replitDomain) return `https://${replitDomain}`;

  return "http://localhost:5173";
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
      ? authHeader.slice("Bearer ".length).trim()
      : null;
    if (!token) {
      return sendJson(res, 401, { error: "missing_auth_token" });
    }

    let user: Awaited<ReturnType<typeof getUserFromToken>>;
    try {
      user = await getUserFromToken(token);
    } catch (authErr) {
      console.error("Checkout auth failed:", authErr);
      req.log.warn({ err: authErr }, "Rejected checkout: invalid Supabase token");
      return sendJson(res, 401, {
        error: errorMessage(authErr) || "invalid_auth_token",
      });
    }

    // Client sends itemId only — pricing comes from the server-side catalog.
    const itemId =
      typeof req.body?.itemId === "string" ? req.body.itemId.trim() : null;
    if (!itemId) {
      console.error("Checkout missing itemId in body:", req.body);
      return sendJson(res, 400, { error: "missing_item_id" });
    }

    const item = getCatalogItem(itemId);
    if (!item) {
      console.error("Checkout unknown itemId:", itemId);
      return sendJson(res, 400, { error: `unknown_item: ${itemId}` });
    }

    req.log.info({ userId: user.id, itemId: item.id }, "Creating Stripe checkout session");

    const stripe = await getUncachableStripeClient();
    const base = publicBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: item.currency,
            unit_amount: item.amount,
            product_data: { name: item.name },
          },
        },
      ],
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        supabase_user_id: user.id,
        item_id: item.id,
      },
      customer_email: user.email ?? undefined,
      success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?checkout=cancel`,
    });

    if (!session.url) {
      throw new Error("Stripe returned a checkout session without a url");
    }

    const environment =
      process.env.NODE_ENV === "production" ? "live" : "test";

    const { error: paymentInsertError } = await getSupabaseAdmin()
      .from("payments")
      .insert({
        user_id: user.id,
        gateway: "stripe",
        gateway_order_id: session.id,
        environment,
        amount: item.amount,
        currency: item.currency,
        status: "pending",
      });

    if (paymentInsertError) {
      req.log.warn(
        { err: paymentInsertError, sessionId: session.id },
        "Failed to insert pending payment row — webhook may not update payments",
      );
    }

    return sendJson(res, 200, { url: session.url });
  } catch (err) {
    console.error("Failed to create Stripe checkout session:", err);
    req.log.error({ err }, "Failed to create Stripe checkout session");
    sendJsonError(res, 500, err, "Server Error");
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
      ? authHeader.slice("Bearer ".length).trim()
      : null;
    if (!token) {
      return sendJson(res, 401, { error: "missing_auth_token" });
    }

    let user: Awaited<ReturnType<typeof getUserFromToken>>;
    try {
      user = await getUserFromToken(token);
    } catch (authErr) {
      req.log.warn({ err: authErr }, "Rejected verify: invalid Supabase token");
      return sendJson(res, 401, {
        error: errorMessage(authErr) || "invalid_auth_token",
      });
    }

    const sessionId =
      typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
    if (!sessionId) {
      return sendJson(res, 400, { error: "missing_session_id" });
    }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const sessionUser = extractCheckoutUserId(session);
    if (sessionUser !== user.id) {
      req.log.warn(
        { sessionUser, requestUser: user.id, sessionId },
        "Rejected verify: session does not belong to requesting user",
      );
      return sendJson(res, 403, { error: "session_user_mismatch" });
    }

    if (session.payment_status === "paid") {
      await fulfillCheckoutSession(session, req.log);
      const itemId = session.metadata?.item_id ?? null;
      req.log.info(
        { userId: user.id, sessionId, itemId },
        "Verified checkout on return — fulfillment complete",
      );
      return sendJson(res, 200, { unlocked: true, itemId });
    }

    req.log.info(
      { userId: user.id, sessionId, paymentStatus: session.payment_status },
      "Verify on return: session not paid yet",
    );
    return sendJson(res, 200, {
      unlocked: false,
      payment_status: session.payment_status,
    });
  } catch (err) {
    console.error("Checkout verify failed:", err);
    req.log.error({ err }, "Checkout verify failed");
    sendJsonError(res, 500, err, "Server Error");
  }
});

export default router;
