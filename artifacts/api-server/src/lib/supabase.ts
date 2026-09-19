/**
 * Server-side Supabase helpers.
 *
 * Caller authentication uses the anon key plus the caller's JWT. All payment
 * rows and entitlement fulfillment use the service-role client and are never
 * exposed as client-writeable operations.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];

export type UserEntitlementsSummary = {
  has_base_game: boolean;
  has_all_access: boolean;
  owned_items: string[];
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function requireHttpOrigin(name: string): string {
  const raw = requireEnv(name);
  // Be defensive against values pasted from rich-text editors as Markdown.
  const markdownLink = raw.match(/^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  const candidate = markdownLink?.[1] ?? raw;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${name} uses an invalid protocol`);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a plain origin`);
  }
  return url.origin;
}

const SUPABASE_URL = requireHttpOrigin("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");

function getServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

let adminClient: SupabaseClient<Database> | null = null;
let authVerifyClient: SupabaseClient<Database> | null = null;

function getSupabaseAuthClient(): SupabaseClient<Database> {
  if (!authVerifyClient) {
    authVerifyClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return authVerifyClient;
}

/** Service-role client — bypasses RLS. Keep it server-side only. */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (!adminClient) {
    adminClient = createClient<Database>(SUPABASE_URL, getServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

export async function getUserFromToken(
  accessToken: string,
): Promise<{ id: string; email: string | null }> {
  const { data, error } = await getSupabaseAuthClient().auth.getUser(
    accessToken.trim(),
  );
  if (error || !data.user) {
    throw new Error("invalid_supabase_session");
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function getUserEntitlements(
  userId: string,
): Promise<UserEntitlementsSummary> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_entitlements")
    .select("has_base_game, has_all_access, owned_items")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`entitlements lookup failed: ${error.message}`);
  return {
    has_base_game: !!data?.has_base_game,
    has_all_access: !!data?.has_all_access,
    owned_items: Array.isArray(data?.owned_items) ? data.owned_items : [],
  };
}

export function entitlementsOwnItem(
  entitlements: UserEntitlementsSummary,
  itemId: string,
): boolean {
  if (itemId === "all_access") return entitlements.has_all_access;
  if (itemId === "base_game") {
    return entitlements.has_base_game || entitlements.has_all_access;
  }
  return (
    entitlements.has_all_access || entitlements.owned_items.includes(itemId)
  );
}

async function ensureProfile(userId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("profiles")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`profile provisioning failed: ${error.message}`);
}

export async function createPayment(
  payment: PaymentInsert,
): Promise<PaymentRow> {
  await ensureProfile(payment.user_id);
  const { data, error } = await getSupabaseAdmin()
    .from("payments")
    .insert(payment)
    .select("*")
    .single();
  if (error) throw new Error(`payment insert failed: ${error.message}`);
  return data;
}

export async function markPaymentInvoiceCreated(input: {
  paymentId: string;
  transactionNo: string;
}): Promise<void> {
  const { data, error } = await getSupabaseAdmin()
    .from("payments")
    .update({
      gateway_order_id: input.transactionNo,
      status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.paymentId)
    .eq("gateway", "paylink")
    .select("id");
  if (error || !data?.length) {
    throw new Error(`payment update failed: ${error?.message ?? "not found"}`);
  }
}

export async function markPaymentStatus(input: {
  paymentId: string;
  status: "creating" | "pending" | "canceled" | "failed";
  transactionNo?: string;
  paymentMethod?: string | null;
  verified?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("payments")
    .update({
      status: input.status,
      updated_at: now,
      ...(input.transactionNo ? { gateway_order_id: input.transactionNo } : {}),
      ...(input.paymentMethod !== undefined
        ? { payment_method: input.paymentMethod }
        : {}),
      ...(input.verified ? { verified_at: now } : {}),
    })
    .eq("id", input.paymentId)
    .eq("gateway", "paylink")
    .neq("status", "completed");
  if (error) throw new Error(`payment status update failed: ${error.message}`);
}

export async function findPaymentByOrderNumber(
  orderNumber: string,
): Promise<PaymentRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("payments")
    .select("*")
    .eq("gateway", "paylink")
    .eq("merchant_order_number", orderNumber)
    .maybeSingle();
  if (error) throw new Error(`payment lookup failed: ${error.message}`);
  return data;
}

export async function findPaymentByTransactionNo(
  transactionNo: string,
): Promise<PaymentRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("payments")
    .select("*")
    .eq("gateway", "paylink")
    .eq("gateway_order_id", transactionNo)
    .maybeSingle();
  if (error) throw new Error(`payment lookup failed: ${error.message}`);
  return data;
}

export async function completeVerifiedPaylinkPayment(input: {
  paymentId: string;
  transactionNo: string;
  amount: number;
  currency: string;
}): Promise<{ itemId: string; userId: string; alreadyCompleted: boolean }> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "complete_verified_paylink_payment",
    {
      target_payment: input.paymentId,
      expected_transaction_no: input.transactionNo,
      expected_amount: input.amount,
      expected_currency: input.currency,
    },
  );
  if (error) {
    throw new Error(`payment fulfillment failed: ${error.message}`);
  }
  const result = data?.[0];
  if (!result?.item_id || !result.user_id) {
    throw new Error("payment fulfillment returned no result");
  }
  return {
    itemId: result.item_id,
    userId: result.user_id,
    alreadyCompleted: !!result.already_completed,
  };
}

/** Retained for non-payment administrative flows. */
export async function grantSpecificEntitlement(
  userId: string,
  itemId: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("grant_specific_entitlement", {
    target_user: userId,
    item_id: itemId,
  });
  if (error) {
    throw new Error(`grant_specific_entitlement RPC failed: ${error.message}`);
  }
}
