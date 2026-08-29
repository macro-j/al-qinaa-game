import { apiUrl, readResponseJson } from "./api";
import { getValidAccessToken } from "./supabase";
import {
  loadDistributionHistory,
  mergeDistributionHistory,
} from "./roleDistribution";

/**
 * Merges this browser's role memory with the signed-in account's memory.
 * The private cloud copy is served through the authenticated API. Local memory
 * remains authoritative if auth, storage, or the network is unavailable.
 */
export async function syncDistributionHistory(_userId: string): Promise<void> {
  const token = await getValidAccessToken();
  if (!token) return;

  const readResponse = await fetch(apiUrl("/api/distribution-history"), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const readBody = await readResponseJson<{ entries?: unknown[]; error?: string }>(readResponse);
  if (!readResponse.ok) {
    console.warn("Distribution history sync failed:", readBody.error ?? readResponse.status);
    return;
  }

  const remoteEntries = Array.isArray(readBody.entries) ? readBody.entries : [];
  const merged = mergeDistributionHistory(remoteEntries);
  const entries = merged.length > 0 ? merged : loadDistributionHistory();

  const writeResponse = await fetch(apiUrl("/api/distribution-history"), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ entries }),
  });
  if (!writeResponse.ok) {
    const writeBody = await readResponseJson<{ error?: string }>(writeResponse);
    console.warn("Distribution history upload failed:", writeBody.error ?? writeResponse.status);
  }
}
