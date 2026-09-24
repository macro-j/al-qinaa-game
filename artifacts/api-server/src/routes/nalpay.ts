import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getPaylinkCatalogItem } from "../lib/paylinkCatalog";
import { resolveQinaaOffer } from "@workspace/qinaa-rules";
import {
  createNalpayCustomer,
  createNalpayPaymentLink,
  getNalpayAccount,
  getNalpayEnvironment,
  getNalpayPayment,
  getNalpayPaymentLink,
  listNalpayPaymentsForLink,
  NalpayApiError,
  type NalpayPayment,
} from "../lib/nalpay";
import {
  completeVerifiedNalpayPayment,
  createPayment,
  findActiveNalpayPayment,
  findNalpayPaymentById,
  findPaymentByNalpayLinkId,
  getUserEntitlements,
  getUserFromToken,
  markNalpayLinkCreated,
  markPaymentStatus,
  refundVerifiedNalpayPayment,
} from "../lib/supabase";

const router: IRouter = Router();
const NALPAY_MINIMUM_AMOUNT = 1_000;
const WEBHOOK_TOLERANCE_SECONDS = 300;

function json(res: Response, status: number, body: Record<string, unknown>) {
  return res.status(status).json(body);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null;
}

async function authenticatedUser(req: Request, res: Response) {
  const token = bearerToken(req);
  if (!token) {
    json(res, 401, { error: "missing_auth_token" });
    return null;
  }
  try {
    return await getUserFromToken(token);
  } catch (error) {
    req.log.warn(
      { reason: error instanceof Error ? error.message : "unknown_error" },
      "Rejected NalPay request with an invalid Supabase session",
    );
    json(res, 401, { error: "invalid_auth_token" });
    return null;
  }
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 80 ? name : null;
}

function normalizeSaudiMobile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const latinDigits = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  let mobile = latinDigits.replace(/[\s()+-]/g, "");
  if (mobile.startsWith("9665")) mobile = `0${mobile.slice(3)}`;
  return /^05\d{8}$/.test(mobile) ? mobile : null;
}

function validLocalPaymentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function safeGatewayDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const source = details as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (typeof source.requestId === "string") safe.requestId = source.requestId;
  const response = source.response;
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const gateway = response as Record<string, unknown>;
    for (const key of ["code", "type", "message"]) {
      if (typeof gateway[key] === "string") safe[key] = gateway[key].slice(0, 300);
    }
  }
  return safe;
}

type StoredNalpayPayment = NonNullable<
  Awaited<ReturnType<typeof findNalpayPaymentById>>
>;

function assertPaymentMatches(input: {
  stored: StoredNalpayPayment;
  gateway: NalpayPayment;
}): void {
  const { stored, gateway } = input;
  if (!stored.item_id || !stored.gateway_order_id) {
    throw new Error("payment_record_incomplete");
  }
  if (stored.environment !== getNalpayEnvironment()) {
    throw new Error("payment_environment_mismatch");
  }
  if (gateway.payment_link !== stored.gateway_order_id) {
    throw new Error("payment_link_mismatch");
  }
  if (gateway.amount !== stored.amount) throw new Error("amount_mismatch");
  if (gateway.currency.toUpperCase() !== (stored.currency ?? "SAR").toUpperCase()) {
    throw new Error("currency_mismatch");
  }
  const metadata = gateway.metadata ?? {};
  if (
    metadata.payment_id !== stored.id ||
    metadata.user_id !== stored.user_id ||
    metadata.item_id !== stored.item_id ||
    metadata.order_number !== stored.merchant_order_number
  ) {
    throw new Error("payment_metadata_mismatch");
  }
  if (gateway.simulated && stored.environment !== "test") {
    throw new Error("simulated_live_payment_rejected");
  }
}

async function verifyAndFulfill(input: {
  stored: StoredNalpayPayment;
  gatewayPaymentId: string;
  eventId?: string | null;
}) {
  const gateway = await getNalpayPayment(input.gatewayPaymentId);
  assertPaymentMatches({ stored: input.stored, gateway });
  if (gateway.status !== "paid") {
    return {
      itemId: input.stored.item_id!,
      status: gateway.status,
      unlocked: false,
    };
  }
  const result = await completeVerifiedNalpayPayment({
    paymentId: input.stored.id,
    linkId: input.stored.gateway_order_id!,
    gatewayPaymentId: gateway.id,
    amount: gateway.amount,
    currency: gateway.currency,
    eventId: input.eventId,
  });
  return { itemId: result.itemId, status: "paid" as const, unlocked: true };
}

router.post("/payment/nalpay-link", async (req, res) => {
  const user = await authenticatedUser(req, res);
  if (!user) return;

  const itemId = typeof req.body?.itemId === "string" ? req.body.itemId : "";
  const catalogItem = getPaylinkCatalogItem(itemId);
  if (!catalogItem) return json(res, 400, { error: "unknown_item" });
  const clientName = normalizeName(req.body?.clientName);
  if (!clientName) return json(res, 400, { error: "invalid_client_name" });
  const clientMobile = normalizeSaudiMobile(req.body?.clientMobile);
  if (!clientMobile) return json(res, 400, { error: "invalid_client_mobile" });

  let paymentId: string | null = null;
  try {
    const [account, entitlements] = await Promise.all([
      getNalpayAccount(),
      getUserEntitlements(user.id),
    ]);
    if (!account.capabilities.can_charge) {
      return json(res, 503, { error: "payment_gateway_inactive" });
    }
    const item = resolveQinaaOffer(catalogItem.id, entitlements.owned_items);
    if (!item) {
      return json(res, 409, {
        error:
          catalogItem.kind === "full_bundle"
            ? "bundle_not_available"
            : "already_owned",
      });
    }
    if (item.amount < NALPAY_MINIMUM_AMOUNT) {
      return json(res, 409, { error: "item_below_gateway_minimum" });
    }

    const activePayment = await findActiveNalpayPayment(
      user.id,
      item.id,
      getNalpayEnvironment(),
    );
    if (activePayment?.gateway_order_id) {
      const activeLink = await getNalpayPaymentLink(
        activePayment.gateway_order_id,
      );
      if (activeLink.status === "open") {
        return json(res, 200, {
          checkoutUrl: activeLink.url,
          paymentId: activePayment.id,
          expiresAt: activeLink.expires_at ?? null,
          reused: true,
        });
      }
      await markPaymentStatus({
        paymentId: activePayment.id,
        gateway: "nalpay",
        status:
          activeLink.status === "canceled" ? "canceled" : "failed",
        verified: true,
      });
    } else if (
      activePayment &&
      Date.now() - new Date(activePayment.created_at).getTime() < 2 * 60 * 1000
    ) {
      return json(res, 409, { error: "payment_in_progress" });
    } else if (activePayment) {
      await markPaymentStatus({
        paymentId: activePayment.id,
        gateway: "nalpay",
        status: "failed",
      });
    }

    paymentId = randomUUID();
    const orderNumber = `QN${paymentId.replaceAll("-", "")}`;
    try {
      await createPayment({
        id: paymentId,
        user_id: user.id,
        item_id: item.id,
        amount: item.amount,
        currency: item.currency,
        credits_granted: item.creditsGranted,
        roles_granted: item.rolesGranted,
        gateway: "nalpay",
        gateway_order_id: null,
        gateway_payment_id: null,
        merchant_order_number: orderNumber,
        idempotency_key: `nalpay:${paymentId}`,
        environment: getNalpayEnvironment(),
        status: "creating",
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("payments_nalpay_active_purchase_unique")
      ) {
        return json(res, 409, { error: "payment_in_progress" });
      }
      throw error;
    }

    const customer = await createNalpayCustomer({
      name: clientName,
      email: user.email,
      phone: clientMobile,
      idempotencyKey: `${paymentId}:customer`,
    });
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const link = await createNalpayPaymentLink({
      amount: item.amount,
      currency: item.currency,
      description: item.title,
      customerId: customer.id,
      expiresAt,
      metadata: {
        payment_id: paymentId,
        user_id: user.id,
        item_id: item.id,
        order_number: orderNumber,
      },
      idempotencyKey: `${paymentId}:payment-link`,
    });
    await markNalpayLinkCreated({ paymentId, linkId: link.id });

    req.log.info(
      { paymentId, itemId: item.id, environment: getNalpayEnvironment() },
      "NalPay payment link created",
    );
    return json(res, 200, {
      checkoutUrl: link.url,
      paymentId,
      expiresAt,
    });
  } catch (error) {
    if (paymentId) {
      await markPaymentStatus({
        paymentId,
        gateway: "nalpay",
        status: "failed",
      }).catch(() => {});
    }
    req.log.error(
      {
        paymentId,
        message: error instanceof Error ? error.message : "unknown_error",
        status: error instanceof NalpayApiError ? error.status : undefined,
        gatewayError:
          error instanceof NalpayApiError
            ? safeGatewayDetails(error.details)
            : undefined,
      },
      "Failed to create NalPay payment link",
    );
    const notConfigured =
      error instanceof Error && /NALPAY_SECRET_KEY/.test(error.message);
    return json(res, notConfigured ? 503 : 502, {
      error: notConfigured ? "payment_not_configured" : "payment_start_failed",
    });
  }
});

router.post("/payment/nalpay-verify", async (req, res) => {
  const user = await authenticatedUser(req, res);
  if (!user) return;
  const paymentId = req.body?.paymentId;
  if (!validLocalPaymentId(paymentId)) {
    return json(res, 400, { error: "invalid_payment_reference" });
  }

  try {
    const stored = await findNalpayPaymentById(paymentId);
    if (!stored) return json(res, 404, { error: "payment_not_found" });
    if (stored.user_id !== user.id) {
      return json(res, 403, { error: "payment_user_mismatch" });
    }
    if (stored.status === "completed") {
      return json(res, 200, {
        itemId: stored.item_id,
        status: "paid",
        unlocked: true,
      });
    }
    if (!stored.gateway_order_id) {
      return json(res, 200, {
        itemId: stored.item_id,
        status: "pending",
        unlocked: false,
      });
    }

    const link = await getNalpayPaymentLink(stored.gateway_order_id);
    if (link.status === "open") {
      return json(res, 200, {
        itemId: stored.item_id,
        status: "pending",
        unlocked: false,
      });
    }
    if (["canceled", "expired", "failed"].includes(link.status)) {
      await markPaymentStatus({
        paymentId: stored.id,
        gateway: "nalpay",
        status: link.status === "canceled" ? "canceled" : "failed",
        verified: true,
      });
      return json(res, 200, {
        itemId: stored.item_id,
        status: link.status,
        unlocked: false,
      });
    }

    const listed = await listNalpayPaymentsForLink(stored.gateway_order_id);
    const paid = listed.find(
      (candidate) =>
        candidate.payment_link === stored.gateway_order_id &&
        candidate.status === "paid",
    );
    if (!paid) {
      return json(res, 200, {
        itemId: stored.item_id,
        status: link.status === "refunded" ? "refunded" : "pending",
        unlocked: false,
      });
    }
    const result = await verifyAndFulfill({
      stored,
      gatewayPaymentId: paid.id,
    });
    return json(res, 200, result);
  } catch (error) {
    req.log.error(
      {
        paymentId,
        message: error instanceof Error ? error.message : "unknown_error",
      },
      "NalPay verification failed",
    );
    return json(res, 502, { error: "payment_verification_failed" });
  }
});

function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
  const secret = process.env.NALPAY_WEBHOOK_SECRET?.trim();
  if (!secret || !secret.startsWith("whsec_")) {
    throw new Error("NALPAY_WEBHOOK_SECRET is not configured");
  }
  const parts = new Map(
    signatureHeader.split(",").map((part) => {
      const separator = part.indexOf("=");
      return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !/^\d{10,13}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  const seconds = Number(timestamp.length === 13 ? Number(timestamp) / 1000 : timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

router.post("/payment/nalpay-webhook", async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  const signature = req.headers["nalpay-signature"];
  const delivery = req.headers["nalpay-delivery"];
  if (!rawBody || typeof signature !== "string" || typeof delivery !== "string") {
    return json(res, 400, { error: "invalid_webhook_request" });
  }
  try {
    if (!verifyWebhookSignature(rawBody, signature)) {
      return json(res, 401, { error: "invalid_webhook_signature" });
    }
  } catch (error) {
    req.log.error(
      { message: error instanceof Error ? error.message : "unknown_error" },
      "NalPay webhook is not configured",
    );
    return json(res, 503, { error: "webhook_not_configured" });
  }

  let event: {
    id?: unknown;
    type?: unknown;
    livemode?: unknown;
    data?: unknown;
  };
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return json(res, 400, { error: "invalid_webhook_json" });
  }
  if (
    typeof event.id !== "string" ||
    event.id !== delivery ||
    typeof event.type !== "string" ||
    typeof event.livemode !== "boolean" ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return json(res, 400, { error: "invalid_webhook_event" });
  }
  const expectedLive = getNalpayEnvironment() === "live";
  if (event.livemode !== expectedLive) {
    return json(res, 400, { error: "webhook_mode_mismatch" });
  }
  if (!["payment_paid", "payment_failed", "payment_refunded"].includes(event.type)) {
    return json(res, 200, { received: true, ignored: true });
  }

  const eventPayment = event.data as Partial<NalpayPayment>;
  if (
    typeof eventPayment.id !== "string" ||
    typeof eventPayment.payment_link !== "string"
  ) {
    return json(res, 400, { error: "invalid_payment_event" });
  }

  try {
    const stored = await findPaymentByNalpayLinkId(eventPayment.payment_link);
    if (!stored) {
      req.log.warn(
        { eventId: event.id, linkId: eventPayment.payment_link },
        "Ignored unrelated NalPay webhook",
      );
      return json(res, 200, { received: true, ignored: true });
    }
    const gateway = await getNalpayPayment(eventPayment.id);
    assertPaymentMatches({ stored, gateway });

    if (event.type === "payment_paid") {
      if (gateway.status !== "paid") {
        return json(res, 200, { received: true, ignored: true });
      }
      const fulfilled = await completeVerifiedNalpayPayment({
        paymentId: stored.id,
        linkId: stored.gateway_order_id!,
        gatewayPaymentId: gateway.id,
        amount: gateway.amount,
        currency: gateway.currency,
        eventId: event.id,
      });
      req.log.info(
        { paymentId: stored.id, itemId: fulfilled.itemId, eventId: event.id },
        "Processed NalPay payment",
      );
    } else if (
      event.type === "payment_refunded" &&
      gateway.status === "refunded" &&
      gateway.amount_refunded >= gateway.amount
    ) {
      const refunded = await refundVerifiedNalpayPayment({
        paymentId: stored.id,
        linkId: stored.gateway_order_id!,
        gatewayPaymentId: gateway.id,
        eventId: event.id,
      });
      req.log.info(
        { paymentId: stored.id, itemId: refunded.itemId, eventId: event.id },
        "Processed full NalPay refund",
      );
    } else if (event.type === "payment_failed") {
      req.log.info(
        { paymentId: stored.id, gatewayPaymentId: gateway.id, eventId: event.id },
        "Recorded NalPay failed attempt; payment link remains authoritative",
      );
    }
    return json(res, 200, { received: true });
  } catch (error) {
    req.log.error(
      {
        eventId: event.id,
        message: error instanceof Error ? error.message : "unknown_error",
      },
      "NalPay webhook processing failed",
    );
    return json(res, 503, { error: "webhook_processing_failed" });
  }
});

export default router;
