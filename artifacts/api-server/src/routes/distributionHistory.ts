import { Router, type IRouter, type Request, type Response } from "express";
import { getUserFromToken } from "../lib/supabase";
import {
  readCloudDistributionHistory,
  writeCloudDistributionHistory,
} from "../lib/distributionHistory";

const router: IRouter = Router();
const MAX_HISTORY_ENTRIES = 80;
const MAX_BODY_BYTES = 256 * 1024;

function sendJson(res: Response, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) return;
  res.status(status).type("application/json").send(JSON.stringify(body));
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim() || null
    : null;
}

async function authenticatedUser(req: Request, res: Response) {
  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "missing_auth_token" });
    return null;
  }
  try {
    return await getUserFromToken(token);
  } catch {
    sendJson(res, 401, { error: "invalid_auth_token" });
    return null;
  }
}

router.get("/distribution-history", async (req, res) => {
  try {
    const user = await authenticatedUser(req, res);
    if (!user) return;
    const entries = await readCloudDistributionHistory(user.id);
    return sendJson(res, 200, { entries });
  } catch (error) {
    req.log.error({ error }, "Distribution history read failed");
    return sendJson(res, 500, { error: "distribution_history_read_failed" });
  }
});

router.put("/distribution-history", async (req, res) => {
  try {
    const user = await authenticatedUser(req, res);
    if (!user) return;
    const entries = req.body?.entries;
    if (!Array.isArray(entries) || entries.length > MAX_HISTORY_ENTRIES) {
      return sendJson(res, 400, { error: "invalid_distribution_history" });
    }
    if (Buffer.byteLength(JSON.stringify({ entries }), "utf8") > MAX_BODY_BYTES) {
      return sendJson(res, 413, { error: "distribution_history_too_large" });
    }
    await writeCloudDistributionHistory(user.id, entries);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    req.log.error({ error }, "Distribution history write failed");
    return sendJson(res, 500, { error: "distribution_history_write_failed" });
  }
});

export default router;
