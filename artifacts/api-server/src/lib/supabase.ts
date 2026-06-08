/**
 * Server-side Supabase helpers used by the Stripe payment flow.
 *
 * We talk to Supabase over plain REST (no SDK) to keep the server bundle small:
 *  - getUserFromToken: verifies a client's access token → trusted user id/email.
 *  - unlockAllAccess:  grants the All-Access entitlement via a SECURITY DEFINER
 *                      RPC, authenticated with the service-role key (bypasses
 *                      RLS). Called ONLY from the verified Stripe webhook.
 */

// Public project URL + anon key (anon key is a publishable client key, safe to
// embed — it is protected by Row-Level Security).
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://ftfizfcrxgochuthofnd.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0Zml6ZmNyeGdvY2h1dGhvZm5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTg4ODYsImV4cCI6MjA5NjMzNDg4Nn0.jgYetV7ueqE6TSQjnwswT1Lq0j5C6dijMcmL3MugrOs";

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

/**
 * Verifies a Supabase access token and returns the authenticated user.
 * Throws if the token is missing/invalid.
 */
export async function getUserFromToken(
  accessToken: string,
): Promise<{ id: string; email: string | null }> {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`Invalid Supabase session token: ${resp.status}`);
  }

  const user = (await resp.json()) as { id?: string; email?: string | null };
  if (!user?.id) {
    throw new Error("Supabase user not found for the provided token.");
  }
  return { id: user.id, email: user.email ?? null };
}

/**
 * Grants a SPECIFIC purchased entitlement to a user via the SECURITY DEFINER
 * RPC, using the service-role key. This is the ONLY server-side write path for
 * the paid flags and must be called only after a verified, completed payment.
 * The RPC unlocks exactly the item identified by `itemId` (e.g. base_game,
 * all_access, ad_removal, role_*).
 */
export async function grantSpecificEntitlement(
  userId: string,
  itemId: string,
): Promise<void> {
  const serviceRoleKey = getServiceRoleKey();
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/grant_specific_entitlement`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ target_user: userId, item_id: itemId }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `grant_specific_entitlement RPC failed: ${resp.status} ${text}`,
    );
  }
}
