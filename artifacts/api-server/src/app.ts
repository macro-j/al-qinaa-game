import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import type Stripe from "stripe";
import router from "./routes";
import { logger } from "./lib/logger";
import { getUncachableStripeClient } from "./lib/stripeClient";
import { unlockAllAccess } from "./lib/supabase";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── Stripe webhook ──────────────────────────────────────────────────────────
// MUST be registered BEFORE express.json(): signature verification needs the
// raw request body, not a parsed object. Fulfillment is server-side and
// signature-verified, so it cannot be faked by a client.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sigHeader = req.headers["stripe-signature"];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      req.log.error("Stripe webhook missing signature or STRIPE_WEBHOOK_SECRET");
      return res.status(400).json({ error: "bad_request" });
    }

    if (!Buffer.isBuffer(req.body)) {
      req.log.error(
        "Stripe webhook body is not a Buffer — express.json() ran before this route",
      );
      return res.status(500).json({ error: "server_misconfigured" });
    }

    let event: Stripe.Event;
    try {
      const stripe = await getUncachableStripeClient();
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err) {
      req.log.error({ err }, "Stripe webhook signature verification failed");
      return res.status(400).json({ error: "invalid_signature" });
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          session.metadata?.supabase_user_id ??
          session.client_reference_id ??
          null;

        if (session.payment_status === "paid" && userId) {
          await unlockAllAccess(userId);
          req.log.info({ userId }, "Granted All-Access after verified payment");
        } else {
          req.log.warn(
            { paymentStatus: session.payment_status, userId },
            "checkout.session.completed ignored (not paid or no user id)",
          );
        }
      }
      return res.status(200).json({ received: true });
    } catch (err) {
      req.log.error({ err }, "Stripe webhook fulfillment failed");
      return res.status(500).json({ error: "fulfillment_failed" });
    }
  },
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
