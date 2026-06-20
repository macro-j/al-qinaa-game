import { Router, type IRouter, type Response } from "express";
import { getSupabaseAdmin, getUserFromToken } from "../lib/supabase";

const router: IRouter = Router();

function sendJson(res: Response, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) return;
  res
    .status(status)
    .type("application/json")
    .send(JSON.stringify(body));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Permanently deletes the authenticated user's account and related data.
 * Requires a valid Supabase access token (Bearer).
 */
router.post("/account/delete", async (req, res) => {
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
      console.error("Account delete auth failed:", authErr);
      return sendJson(res, 401, {
        error: errorMessage(authErr) || "invalid_auth_token",
      });
    }

    const admin = getSupabaseAdmin();
    const userId = user.id;

    const { error: paymentsError } = await admin
      .from("payments")
      .delete()
      .eq("user_id", userId);
    if (paymentsError) {
      throw new Error(`payments delete failed: ${paymentsError.message}`);
    }

    const { error: profileError } = await admin
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profileError) {
      throw new Error(`profiles delete failed: ${profileError.message}`);
    }

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      throw new Error(`auth delete failed: ${deleteUserError.message}`);
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error("Account delete failed:", err);
    return sendJson(res, 500, {
      error: errorMessage(err) || "delete_failed",
    });
  }
});

export default router;
