import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  assertInvoiceMatches,
  createPaylinkInvoice,
  getPaylinkEnvironment,
  getPaylinkInvoice,
  normalizePaylinkStatus,
  PaylinkApiError,
} from "../lib/paylink";
import { getPaylinkCatalogItem } from "../lib/paylinkCatalog";
import {
  completeVerifiedPaylinkPayment,
  createPayment,
  entitlementsOwnItem,
  findPaymentByOrderNumber,
  findPaymentByTransactionNo,
  getUserEntitlements,
  getUserFromToken,
  markPaymentInvoiceCreated,
  markPaymentStatus,
} from "../lib/supabase";

const router: IRouter = Router();

function json(
  res: Response,
  status: number,
  body: Record<string, unknown>,
): Response {
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
      {
        reason: error instanceof Error ? error.message : "unknown_error",
      },
      "Rejected payment request with an invalid Supabase session",
    );
    json(res, 401, { error: "invalid_auth_token" });
    return null;
  }
}

function publicAppUrl(): string {
  const raw =
    process.env.PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.FRONTEND_URL ??
    (process.env.NODE_ENV === "production" ? null : "http://localhost:5173");
  if (!raw) throw new Error("PUBLIC_APP_URL is not configured");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_APP_URL is invalid");
  }
  if (
    (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
    !["http:", "https:"].includes(url.protocol)
  ) {
    throw new Error("PUBLIC_APP_URL uses an invalid protocol");
  }
  return url.origin;
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

function validOrderNumber(value: unknown): value is string {
  return typeof value === "string" && /^QN[A-Fa-f0-9]{32}$/.test(value);
}

function validTransactionNo(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(value);
}

function secureStringEquals(
  actual: string | undefined,
  expected: string,
): boolean {
  if (!actual) return false;
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function safePaylinkErrorDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }
  const source = details as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["code", "status", "title", "message", "detail", "error"]) {
    const value = source[key];
    if (typeof value === "string") safe[key] = value.slice(0, 300);
    else if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  return safe;
}

function isInactivePaylinkMerchant(error: unknown): boolean {
  if (
    !(error instanceof PaylinkApiError) ||
    error.operation !== "create_invoice" ||
    error.status !== 406 ||
    !error.details ||
    typeof error.details !== "object"
  ) {
    return false;
  }
  const details = error.details as Record<string, unknown>;
  const text = [details.title, details.detail, details.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return text.includes("حسابك غير مفعل");
}

type StoredPayment = NonNullable<
  Awaited<ReturnType<typeof findPaymentByOrderNumber>>
>;

async function verifyStoredPayment(input: {
  payment: StoredPayment;
  transactionNo: string;
}): Promise<{
  itemId: string;
  status: "paid" | "pending" | "canceled";
  unlocked: boolean;
}> {
  const { payment, transactionNo } = input;
  if (!payment.item_id || !payment.merchant_order_number) {
    throw new Error("payment_record_incomplete");
  }
  if (payment.environment !== getPaylinkEnvironment()) {
    throw new Error("payment_environment_mismatch");
  }
  if (payment.gateway_order_id && payment.gateway_order_id !== transactionNo) {
    throw new PaylinkApiError("paylink_transaction_mismatch", 409);
  }

  const invoice = await getPaylinkInvoice(transactionNo);
  assertInvoiceMatches({
    invoice,
    transactionNo,
    orderNumber: payment.merchant_order_number,
    amount: payment.amount,
    currency: payment.currency ?? "SAR",
  });
  const status = normalizePaylinkStatus(invoice.orderStatus);
  const paymentMethod =
    invoice.paymentReceipt &&
    typeof invoice.paymentReceipt === "object" &&
    "paymentMethod" in invoice.paymentReceipt &&
    typeof invoice.paymentReceipt.paymentMethod === "string"
      ? invoice.paymentReceipt.paymentMethod
      : null;

  if (status === "paid") {
    const fulfilled = await completeVerifiedPaylinkPayment({
      paymentId: payment.id,
      transactionNo,
      amount: payment.amount,
      currency: payment.currency ?? "SAR",
    });
    return { itemId: fulfilled.itemId, status, unlocked: true };
  }

  if (status === "pending" || status === "canceled") {
    await markPaymentStatus({
      paymentId: payment.id,
      transactionNo,
      status,
      paymentMethod,
      verified: true,
    });
    return { itemId: payment.item_id, status, unlocked: false };
  }

  throw new PaylinkApiError("paylink_unknown_payment_status", 502);
}

router.post("/payment/paylink-invoice", async (req, res) => {
  const user = await authenticatedUser(req, res);
  if (!user) return;

  const itemId = typeof req.body?.itemId === "string" ? req.body.itemId : "";
  const item = getPaylinkCatalogItem(itemId);
  if (!item) return json(res, 400, { error: "unknown_item" });

  const clientName = normalizeName(req.body?.clientName);
  if (!clientName) return json(res, 400, { error: "invalid_client_name" });
  const clientMobile = normalizeSaudiMobile(req.body?.clientMobile);
  if (!clientMobile) {
    return json(res, 400, { error: "invalid_client_mobile" });
  }

  let paymentId: string | null = null;
  try {
    const entitlements = await getUserEntitlements(user.id);
    if (entitlementsOwnItem(entitlements, item.id)) {
      return json(res, 409, { error: "already_owned" });
    }
    if (
      item.requiresBaseGame &&
      !entitlements.has_base_game &&
      !entitlements.has_all_access
    ) {
      return json(res, 409, { error: "base_game_required" });
    }

    paymentId = randomUUID();
    const orderNumber = `QN${paymentId.replaceAll("-", "")}`;
    await createPayment({
      id: paymentId,
      user_id: user.id,
      item_id: item.id,
      amount: item.amount,
      currency: item.currency,
      gateway: "paylink",
      gateway_order_id: null,
      merchant_order_number: orderNumber,
      idempotency_key: paymentId,
      environment: getPaylinkEnvironment(),
      status: "creating",
    });

    const appBase = publicAppUrl();
    const created = await createPaylinkInvoice({
      orderNumber,
      item,
      clientName,
      clientEmail: user.email,
      clientMobile,
      callbackUrl: `${appBase}/payment-success`,
      cancelUrl: `${appBase}/?gateway=paylink&checkout=cancel`,
    });
    await markPaymentInvoiceCreated({
      paymentId,
      transactionNo: created.transactionNo,
    });

    req.log.info(
      { paymentId, itemId: item.id, environment: getPaylinkEnvironment() },
      "Paylink invoice created",
    );
    return json(res, 200, {
      checkoutUrl: created.checkoutUrl,
      orderNumber,
    });
  } catch (error) {
    if (paymentId) {
      await markPaymentStatus({ paymentId, status: "failed" }).catch(() => {});
    }
    req.log.error(
      {
        paymentId,
        message: error instanceof Error ? error.message : "unknown_error",
        status: error instanceof PaylinkApiError ? error.status : undefined,
        operation:
          error instanceof PaylinkApiError ? error.operation : undefined,
        gatewayError:
          error instanceof PaylinkApiError
            ? safePaylinkErrorDetails(error.details)
            : undefined,
      },
      "Failed to create Paylink invoice",
    );
    const notConfigured =
      error instanceof Error &&
      /PAYLINK_(?:API_ID|SECRET_KEY)|PUBLIC_APP_URL/.test(error.message);
    const inactiveMerchant = isInactivePaylinkMerchant(error);
    return json(res, notConfigured || inactiveMerchant ? 503 : 502, {
      error: notConfigured
        ? "payment_not_configured"
        : inactiveMerchant
          ? "payment_gateway_inactive"
          : "payment_start_failed",
    });
  }
});

router.post("/payment/paylink-verify", async (req, res) => {
  const user = await authenticatedUser(req, res);
  if (!user) return;

  const orderNumber = req.body?.orderNumber;
  const transactionNo = req.body?.transactionNo;
  if (!validOrderNumber(orderNumber) || !validTransactionNo(transactionNo)) {
    return json(res, 400, { error: "invalid_payment_reference" });
  }

  try {
    const payment = await findPaymentByOrderNumber(orderNumber);
    if (!payment) return json(res, 404, { error: "payment_not_found" });
    if (payment.user_id !== user.id) {
      return json(res, 403, { error: "payment_user_mismatch" });
    }
    const result = await verifyStoredPayment({ payment, transactionNo });
    return json(res, 200, result);
  } catch (error) {
    req.log.error(
      {
        orderNumber,
        message: error instanceof Error ? error.message : "unknown_error",
      },
      "Paylink verification failed",
    );
    return json(res, 502, { error: "payment_verification_failed" });
  }
});

router.post("/payment/paylink-webhook", async (req, res) => {
  const secret = process.env.PAYLINK_WEBHOOK_TOKEN?.trim();
  const expectedHeader = secret ? `Bearer ${secret}` : "";
  if (!secret) {
    req.log.error("PAYLINK_WEBHOOK_TOKEN is not configured");
    return json(res, 503, { error: "webhook_not_configured" });
  }
  if (!secureStringEquals(req.headers.authorization, expectedHeader)) {
    return json(res, 401, { error: "invalid_webhook_token" });
  }

  const orderNumber = req.body?.merchantOrderNumber;
  const transactionNo = req.body?.transactionNo;
  if (!validTransactionNo(transactionNo)) {
    return json(res, 400, { error: "invalid_transaction_number" });
  }

  try {
    const payment = validOrderNumber(orderNumber)
      ? await findPaymentByOrderNumber(orderNumber)
      : await findPaymentByTransactionNo(transactionNo);

    // A Paylink account can also issue invoices outside the game. Acknowledge
    // those events so Paylink does not retry them ten times.
    if (!payment) {
      req.log.warn({ transactionNo }, "Ignored unrelated Paylink webhook");
      return json(res, 200, { received: true, ignored: true });
    }

    const result = await verifyStoredPayment({ payment, transactionNo });
    req.log.info(
      { paymentId: payment.id, itemId: result.itemId, status: result.status },
      "Processed Paylink webhook",
    );
    return json(res, 200, { received: true });
  } catch (error) {
    req.log.error(
      {
        transactionNo,
        message: error instanceof Error ? error.message : "unknown_error",
      },
      "Paylink webhook processing failed",
    );
    return json(res, 503, { error: "webhook_processing_failed" });
  }
});

export default router;
