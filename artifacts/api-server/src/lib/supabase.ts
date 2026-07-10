/**
 * Server-side Supabase helpers used by the Tap payment flow.
 *
 * Auth verification uses the anon key + the caller's JWT.
 * Fulfillment (profiles premium flag) uses a service-role client that bypasses RLS.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to the project root .env and export it ` +
        "before starting the api-server.",
    );
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");

function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required for the payment " +
        "webhook to grant entitlements. Add it from Supabase → Project " +
        "Settings → API → service_role secret.",
    );
  }
  return key;
}

let adminClient: SupabaseClient<Database> | null = null;
let authVerifyClient: SupabaseClient<Database> | null = null;

/** Anon-key client for verifying caller JWTs (no persisted session). */
function getSupabaseAuthClient(): SupabaseClient<Database> {
  if (!authVerifyClient) {
    authVerifyClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return authVerifyClient;
}

/** Service-role client — bypasses RLS. For webhook fulfillment only. */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (!adminClient) {
    adminClient = createClient<Database>(SUPABASE_URL, getServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

/**
 * Verifies a Supabase access token and returns the authenticated user.
 * Throws if the token is missing/invalid.
 */
export async function getUserFromToken(
  accessToken: string,
): Promise<{ id: string; email: string | null }> {
  const jwt = accessToken.trim();
  const { data, error } = await getSupabaseAuthClient().auth.getUser(jwt);

  if (error || !data.user) {
    console.error(
      "Supabase getUser failed:",
      error?.status,
      error?.message ?? "no user returned",
    );
    throw new Error(
      `Invalid Supabase session token: ${error?.status ?? "unknown"} ${error?.message ?? "no user"}`,
    );
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Resolves a Supabase auth user id from an email address.
 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const normalized = email.trim().toLowerCase();
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw new Error(`auth.admin.listUsers failed: ${error.message}`);
    }

    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === normalized,
    );
    if (match) return match.id;

    if (data.users.length < 200) break;
    page += 1;
  }

  return null;
}

/**
 * Activates premium for the buyer identified by email (profiles.is_premium).
 * Used by the Tap webhook after a CAPTURED charge.
 */
export async function activatePremiumByEmail(email: string): Promise<void> {
  const userId = await findUserIdByEmail(email);
  if (!userId) {
    throw new Error(`No auth user found for email=${email}`);
  }

  await activatePremiumProfile(userId);
  await grantSpecificEntitlement(userId, "all_access");
}

/**
 * Marks a payment row as completed for the given gateway order id.
 */
export async function completePaymentByGatewayOrderId(
  gatewayOrderId: string,
): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("payments")
    .update({
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("gateway_order_id", gatewayOrderId)
    .select("id");

  if (error) {
    throw new Error(
      `payments update failed for gateway_order_id=${gatewayOrderId}: ${error.message}`,
    );
  }

  return data?.length ?? 0;
}

/**
 * Activates premium on the buyer's profile. One-time Checkout purchases are
 * treated as lifetime premium (`premium_until = null`). Pass `premiumUntil`
 * when fulfilling a timed subscription.
 */
export async function activatePremiumProfile(
  userId: string,
  premiumUntil: string | null = null,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("profiles")
    .update({
      is_premium: true,
      premium_until: premiumUntil,
    })
    .eq("id", userId)
    .select("id");

  if (error) {
    throw new Error(`profiles update failed for id=${userId}: ${error.message}`);
  }

  if (data?.length) return;

  const { error: insertError } = await admin.from("profiles").insert({
    id: userId,
    is_premium: true,
    premium_until: premiumUntil,
  });

  if (insertError) {
    throw new Error(
      `profiles insert failed for id=${userId}: ${insertError.message}`,
    );
  }
}

/**
 * Grants a SPECIFIC purchased entitlement via the SECURITY DEFINER RPC.
 * Idempotent — safe to run alongside the webhook verify-on-return path.
 */
export async function grantSpecificEntitlement(
  userId: string,
  itemId: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("grant_specific_entitlement", {
    target_user: userId,
    item_id: itemId,
  });

  if (error) {
    throw new Error(
      `grant_specific_entitlement RPC failed: ${error.message}`,
    );
  }
}
