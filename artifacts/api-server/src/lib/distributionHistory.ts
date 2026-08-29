import { getSupabaseAdmin } from "./supabase";

const BUCKET_ID = "qinaa-private-data";
const HISTORY_FILE = "role-distribution-history.json";

function isAlreadyExists(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already exists") || normalized.includes("duplicate");
}

async function ensurePrivateBucket(): Promise<void> {
  const storage = getSupabaseAdmin().storage;
  const { data, error } = await storage.getBucket(BUCKET_ID);
  if (data && !error) return;

  const { error: createError } = await storage.createBucket(BUCKET_ID, {
    public: false,
    fileSizeLimit: 256 * 1024,
    allowedMimeTypes: ["application/json"],
  });
  if (createError && !isAlreadyExists(createError.message)) {
    throw new Error(`distribution bucket create failed: ${createError.message}`);
  }
}

function historyPath(userId: string): string {
  return `${userId}/${HISTORY_FILE}`;
}

export async function readCloudDistributionHistory(userId: string): Promise<unknown[]> {
  await ensurePrivateBucket();
  const { data, error } = await getSupabaseAdmin().storage
    .from(BUCKET_ID)
    .download(historyPath(userId));

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("not found") || message.includes("does not exist")) return [];
    throw new Error(`distribution history download failed: ${error.message}`);
  }

  try {
    const parsed = JSON.parse(await data.text()) as { entries?: unknown[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export async function writeCloudDistributionHistory(
  userId: string,
  entries: unknown[],
): Promise<void> {
  await ensurePrivateBucket();
  const payload = Buffer.from(JSON.stringify({ version: 1, entries }), "utf8");
  const { error } = await getSupabaseAdmin().storage
    .from(BUCKET_ID)
    .upload(historyPath(userId), payload, {
      contentType: "application/json; charset=utf-8",
      cacheControl: "0",
      upsert: true,
    });
  if (error) {
    throw new Error(`distribution history upload failed: ${error.message}`);
  }
}

export async function deleteCloudDistributionHistory(userId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().storage
    .from(BUCKET_ID)
    .remove([historyPath(userId)]);
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("not found") || message.includes("does not exist")) return;
    throw new Error(`distribution history delete failed: ${error.message}`);
  }
}
