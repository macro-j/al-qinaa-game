const NALPAY_API_BASE = "https://nalpay.io";
const NALPAY_API_VERSION = "2026-09-04";
const REQUEST_TIMEOUT_MS = 15_000;

export type NalpayEnvironment = "test" | "live";

export type NalpayAccount = {
  id: string;
  business_name: string | null;
  mode: NalpayEnvironment;
  livemode: boolean;
  kyc_status: string;
  capabilities: {
    can_charge: boolean;
    can_create_live_keys: boolean;
    subscriptions_enabled: boolean;
  };
};

export type NalpayCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type NalpayPaymentLinkStatus =
  | "open"
  | "paid"
  | "failed"
  | "canceled"
  | "expired"
  | "refunded";

export type NalpayPaymentLink = {
  id: string;
  status: NalpayPaymentLinkStatus;
  amount: number;
  amount_paid: number;
  currency: string;
  description: string;
  url: string;
  customer?: string | null;
  expires_at?: string | null;
  metadata: Record<string, string> | null;
};

export type NalpayPaymentStatus =
  | "initiated"
  | "paid"
  | "authorized"
  | "captured"
  | "failed"
  | "refunded"
  | "voided"
  | "verified";

export type NalpayPayment = {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: NalpayPaymentStatus;
  simulated: boolean;
  customer?: string | null;
  payment_link?: string | null;
  metadata: Record<string, string> | null;
  source?: {
    type?: string | null;
    brand?: string | null;
    last4?: string | null;
    message?: string | null;
    reference_number?: string | null;
  } | null;
};

type NalpayList<T> = { data: T[] | null; has_more: boolean };

export class NalpayApiError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "NalpayApiError";
  }
}

function secretKey(): string {
  const value = process.env.NALPAY_SECRET_KEY?.trim();
  if (!value) throw new Error("NALPAY_SECRET_KEY is not configured");
  if (!/^sk_(?:test|live)_[A-Za-z0-9_-]{8,}$/.test(value)) {
    throw new Error("NALPAY_SECRET_KEY has an invalid format");
  }
  return value;
}

export function getNalpayEnvironment(): NalpayEnvironment {
  return secretKey().startsWith("sk_live_") ? "live" : "test";
}

function assertNalpayId(value: unknown, prefix: string): asserts value is string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value)) {
    throw new NalpayApiError(`nalpay_invalid_${prefix}_id`);
  }
}

function trustedCheckoutUrl(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new NalpayApiError("nalpay_missing_checkout_url");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NalpayApiError("nalpay_invalid_checkout_url");
  }
  const trustedHost = url.hostname === "nalpay.io" || url.hostname.endsWith(".nalpay.io");
  if (url.protocol !== "https:" || !trustedHost || url.username || url.password) {
    throw new NalpayApiError("nalpay_untrusted_checkout_url");
  }
  return url.toString();
}

async function nalpayFetch<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${secretKey()}`);
  headers.set("Accept", "application/json");
  headers.set("Nalpay-Version", NALPAY_API_VERSION);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  }

  let response: globalThis.Response;
  try {
    response = await fetch(`${NALPAY_API_BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    throw new NalpayApiError(
      error instanceof Error && error.name === "AbortError"
        ? "nalpay_timeout"
        : "nalpay_unavailable",
      503,
    );
  } finally {
    clearTimeout(timeout);
  }

  const requestId = response.headers.get("Nalpay-Request-Id");
  const raw = await response.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw.slice(0, 300) };
    }
  }
  if (!response.ok) {
    throw new NalpayApiError("nalpay_request_failed", response.status, {
      requestId,
      response: data,
    });
  }
  return data as T;
}

export async function getNalpayAccount(): Promise<NalpayAccount> {
  const account = await nalpayFetch<NalpayAccount>("/v1/account");
  assertNalpayId(account?.id, "acct");
  if (account.mode !== getNalpayEnvironment() || account.livemode !== (account.mode === "live")) {
    throw new NalpayApiError("nalpay_account_mode_mismatch");
  }
  return account;
}

export async function createNalpayCustomer(input: {
  name: string;
  email: string | null;
  phone: string;
  idempotencyKey: string;
}): Promise<NalpayCustomer> {
  const customer = await nalpayFetch<NalpayCustomer>("/v1/customers", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: JSON.stringify({
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
      phone: input.phone,
    }),
  });
  assertNalpayId(customer?.id, "cus");
  return customer;
}

export async function createNalpayPaymentLink(input: {
  amount: number;
  currency: "SAR";
  description: string;
  customerId: string;
  expiresAt: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}): Promise<NalpayPaymentLink> {
  assertNalpayId(input.customerId, "cus");
  const link = await nalpayFetch<NalpayPaymentLink>("/v1/payment_links", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      customer: input.customerId,
      expires_at: input.expiresAt,
      metadata: input.metadata,
      multiple_payers: false,
    }),
  });
  assertNalpayId(link?.id, "plink");
  link.url = trustedCheckoutUrl(link.url);
  return link;
}

export async function getNalpayPaymentLink(id: string): Promise<NalpayPaymentLink> {
  assertNalpayId(id, "plink");
  const link = await nalpayFetch<NalpayPaymentLink>(`/v1/payment_links/${encodeURIComponent(id)}`);
  assertNalpayId(link?.id, "plink");
  link.url = trustedCheckoutUrl(link.url);
  return link;
}

export async function listNalpayPaymentsForLink(
  paymentLinkId: string,
): Promise<NalpayPayment[]> {
  assertNalpayId(paymentLinkId, "plink");
  const result = await nalpayFetch<NalpayList<NalpayPayment>>(
    `/v1/payments?limit=100&payment_link=${encodeURIComponent(paymentLinkId)}`,
  );
  return Array.isArray(result.data) ? result.data : [];
}

export async function getNalpayPayment(id: string): Promise<NalpayPayment> {
  assertNalpayId(id, "pay");
  const payment = await nalpayFetch<NalpayPayment>(
    `/v1/payments/${encodeURIComponent(id)}`,
  );
  assertNalpayId(payment?.id, "pay");
  return payment;
}
