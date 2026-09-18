import {
  amountToHalalas,
  amountToSar,
  type PaylinkCatalogItem,
} from "./paylinkCatalog";

export type PaylinkEnvironment = "pilot" | "production";

type PaylinkAuthResponse = {
  id_token?: string;
};

export type PaylinkInvoice = {
  amount?: number;
  transactionNo?: string;
  orderStatus?: string;
  url?: string;
  success?: boolean;
  paymentErrors?: unknown;
  paymentReceipt?: {
    paymentMethod?: string;
  } | null;
  gatewayOrderRequest?: {
    orderNumber?: string;
    amount?: number;
    currency?: string;
  };
};

export class PaylinkApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PaylinkApiError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getPaylinkEnvironment(): PaylinkEnvironment {
  const configured = process.env.PAYLINK_ENV?.trim().toLowerCase();
  if (!configured) {
    return process.env.NODE_ENV === "production" ? "production" : "pilot";
  }
  if (configured === "production" || configured === "live") {
    return "production";
  }
  if (configured === "pilot" || configured === "test") return "pilot";
  throw new Error("PAYLINK_ENV must be pilot or production");
}

function apiBase(): string {
  return getPaylinkEnvironment() === "production"
    ? "https://restapi.paylink.sa"
    : "https://restpilot.paylink.sa";
}

async function parseJson(resp: Response): Promise<unknown> {
  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    const text = await resp.text();
    return text ? { message: text.slice(0, 500) } : {};
  }
  return resp.json().catch(() => ({}));
}

async function paylinkFetch(
  path: string,
  init: RequestInit,
): Promise<{ response: Response; data: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    throw new PaylinkApiError("paylink_unavailable", undefined, error);
  }

  const data = await parseJson(response);
  if (!response.ok) {
    throw new PaylinkApiError("paylink_request_failed", response.status, data);
  }
  return { response, data };
}

async function authenticate(): Promise<string> {
  const { data } = await paylinkFetch("/api/auth", {
    method: "POST",
    body: JSON.stringify({
      apiId: requireEnv("PAYLINK_API_ID"),
      secretKey: requireEnv("PAYLINK_SECRET_KEY"),
      persistToken: false,
    }),
  });

  const token = (data as PaylinkAuthResponse).id_token;
  if (typeof token !== "string" || token.length < 20) {
    throw new PaylinkApiError("paylink_auth_failed", 502, data);
  }
  return token;
}

function assertHostedCheckoutUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl) {
    throw new PaylinkApiError("paylink_missing_checkout_url");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PaylinkApiError("paylink_invalid_checkout_url");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".paylink.sa")) {
    throw new PaylinkApiError("paylink_untrusted_checkout_url");
  }
  return url.toString();
}

export async function createPaylinkInvoice(input: {
  orderNumber: string;
  item: PaylinkCatalogItem;
  clientName: string;
  clientEmail: string | null;
  clientMobile: string;
  callbackUrl: string;
  cancelUrl: string;
}): Promise<{
  checkoutUrl: string;
  invoice: PaylinkInvoice;
  transactionNo: string;
}> {
  const token = await authenticate();
  const { data } = await paylinkFetch("/api/addInvoice", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      orderNumber: input.orderNumber,
      amount: amountToSar(input.item.amount),
      callBackUrl: input.callbackUrl,
      cancelUrl: input.cancelUrl,
      clientName: input.clientName,
      ...(input.clientEmail ? { clientEmail: input.clientEmail } : {}),
      clientMobile: input.clientMobile,
      currency: input.item.currency,
      products: [
        {
          title: input.item.title,
          price: amountToSar(input.item.amount),
          qty: 1,
          description: input.item.description,
          isDigital: true,
        },
      ],
      displayPending: true,
      note: `طلب رقمي من لعبة القناع — ${input.orderNumber}`,
    }),
  });

  const invoice = data as PaylinkInvoice;
  if (invoice.success !== true) {
    throw new PaylinkApiError("paylink_invoice_creation_failed", 502, data);
  }
  const transactionNo = invoice.transactionNo;
  if (
    typeof transactionNo !== "string" ||
    !/^[A-Za-z0-9_-]{4,80}$/.test(transactionNo)
  ) {
    throw new PaylinkApiError("paylink_missing_transaction_number", 502, data);
  }
  if (invoice.gatewayOrderRequest?.orderNumber !== input.orderNumber) {
    throw new PaylinkApiError("paylink_order_mismatch", 502, data);
  }
  if (amountToHalalas(Number(invoice.amount)) !== input.item.amount) {
    throw new PaylinkApiError("paylink_amount_mismatch", 502, data);
  }
  if (normalizePaylinkStatus(invoice.orderStatus) !== "pending") {
    throw new PaylinkApiError("paylink_unexpected_invoice_status", 502, data);
  }

  return {
    checkoutUrl: assertHostedCheckoutUrl(invoice.url),
    invoice,
    transactionNo,
  };
}

export async function getPaylinkInvoice(
  transactionNo: string,
): Promise<PaylinkInvoice> {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(transactionNo)) {
    throw new PaylinkApiError("invalid_transaction_number", 400);
  }
  const token = await authenticate();
  const { data } = await paylinkFetch(
    `/api/getInvoice/${encodeURIComponent(transactionNo)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return data as PaylinkInvoice;
}

export function normalizePaylinkStatus(
  value: unknown,
): "paid" | "pending" | "canceled" | "unknown" {
  if (typeof value !== "string") return "unknown";
  switch (value.trim().toLowerCase()) {
    case "paid":
      return "paid";
    case "pending":
      return "pending";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "unknown";
  }
}

export function assertInvoiceMatches(input: {
  invoice: PaylinkInvoice;
  transactionNo: string;
  orderNumber: string;
  amount: number;
  currency: string;
}): void {
  const { invoice } = input;
  if (invoice.success !== true) {
    throw new PaylinkApiError("paylink_invoice_lookup_failed", 502);
  }
  if (invoice.transactionNo !== input.transactionNo) {
    throw new PaylinkApiError("paylink_transaction_mismatch", 502);
  }
  if (invoice.gatewayOrderRequest?.orderNumber !== input.orderNumber) {
    throw new PaylinkApiError("paylink_order_mismatch", 502);
  }
  if (amountToHalalas(Number(invoice.amount)) !== input.amount) {
    throw new PaylinkApiError("paylink_amount_mismatch", 502);
  }
  const responseCurrency = invoice.gatewayOrderRequest?.currency;
  if (
    typeof responseCurrency !== "string" ||
    responseCurrency.toUpperCase() !== input.currency.toUpperCase()
  ) {
    throw new PaylinkApiError("paylink_currency_mismatch", 502);
  }
}
