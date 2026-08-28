import type { Json } from "../supabase";
import { supabase } from "./supabase";
import {
  loadDistributionHistory,
  mergeDistributionHistory,
} from "./roleDistribution";

function isMissingHistoryTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01"
    || error.code === "PGRST205"
    || error.message?.includes("role_distribution_history") === true;
}

/**
 * Merges this browser's role memory with the signed-in account's memory.
 * The local copy remains authoritative when the optional cloud table has not
 * been installed yet, so distribution can never be blocked by the network.
 */
export async function syncDistributionHistory(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("role_distribution_history")
    .select("entries")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (!isMissingHistoryTable(error)) {
      console.warn("Distribution history sync failed:", error.message);
    }
    return;
  }

  const remoteEntries = Array.isArray(data?.entries) ? data.entries : [];
  const merged = mergeDistributionHistory(remoteEntries);
  const entries = merged.length > 0 ? merged : loadDistributionHistory();

  const { error: upsertError } = await supabase
    .from("role_distribution_history")
    .upsert({
      user_id: userId,
      entries: entries as unknown as Json,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (upsertError && !isMissingHistoryTable(upsertError)) {
    console.warn("Distribution history upload failed:", upsertError.message);
  }
}
