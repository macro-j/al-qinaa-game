import { Router, type IRouter, type Response } from "express";
import { activatePremiumByEmail } from "../lib/supabase";

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

function publicAppUrl(req: { get(name: string): string | undefined }): string {
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

function publicServerUrl(req: { get(name: string): string | undefined }): string {
  const configured =
    process.env.PUBLIC_SERVER_URL ??
    process.env.SERVER_URL ??
    process.env.API_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const host = req.get("host");
  if (host) {
    const proto = req.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  }

  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}

/**
 * Creates a Tap charge and returns the hosted checkout URL.
 * Body: { email: string }
 */
router.post("/payment/tap-charge", async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!email) {
      return sendJson(res, 400, { error: "missing_email" });
    }

    const appBase = publicAppUrl(req);
    const serverBase = publicServerUrl(req);

    const payload = {
      amount: 50,
      currency: "SAR",
      threeDSecure: true,
      save_card: false,
      description: "Al-Qinaa Premium Subscription",
      statement_descriptor: "AL-QINAA",
      customer: {
        first_name: "Player",
        email,
      },
      source: { id: "src_all" },
      redirect: { url: `${appBase}/payment-success` },
      post: { url: `${serverBase}/api/payment/tap-webhook` },
    };

    if (!process.env.TAP_SECRET_KEY) {
      req.log.error("TAP_SECRET_KEY is not configured");
      return sendJson(res, 500, { error: "payment_not_configured" });
    }

    req.log.info({ email }, "Creating Tap charge");

    const tapResp = await fetch("https://api.tap.company/v2/charges", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TAP_SECRET_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await tapResp.json()) as {
      transaction?: { url?: string };
      message?: string;
      errors?: unknown;
    };

    if (!tapResp.ok) {
      req.log.error({ status: tapResp.status, data }, "Tap charge API error");
      return sendJson(res, 502, {
        error: data.message ?? "tap_charge_failed",
      });
    }

    const checkoutUrl = data.transaction?.url;
    if (typeof checkoutUrl !== "string" || !checkoutUrl) {
      req.log.error({ data }, "Tap charge response missing transaction.url");
      return sendJson(res, 502, { error: "missing_checkout_url" });
    }

    return sendJson(res, 200, { checkoutUrl });
  } catch (err) {
    console.error("Failed to create Tap charge:", err);
    req.log.error({ err }, "Failed to create Tap charge");
    sendJsonError(res, 500, err, "Server Error");
  }
});

/**
 * Tap webhook — silently POSTed when a charge is captured.
 */
router.post("/payment/tap-webhook", async (req, res) => {
  try {
    const status = req.body?.status;
    const customerEmail = req.body?.customer?.email;

    req.log.info(
      { status, email: customerEmail },
      "Tap webhook received",
    );

    if (status === "CAPTURED") {
      if (typeof customerEmail !== "string" || !customerEmail.trim()) {
        req.log.warn({ body: req.body }, "Tap webhook CAPTURED but missing customer.email");
      } else {
        await activatePremiumByEmail(customerEmail.trim());
        req.log.info({ email: customerEmail }, "Premium activated via Tap webhook");
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Tap webhook fulfillment failed:", err);
    req.log.error({ err }, "Tap webhook fulfillment failed");
    res.status(500).json({ error: "fulfillment_failed" });
  }
});

export default router;
