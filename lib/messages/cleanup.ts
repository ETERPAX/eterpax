import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Trusted server client only. Its transport must bound requests (executor: 5s).
 * No final record deletion. Leases and tombstones survive uncertain outcomes.
 */
export async function recoverMessageFiles(client: SupabaseClient, limit = 2, stopAt = Date.now() + 45_000, scope?: { userId: string; messageId: string }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Invalid cleanup limit");
  const result = { removed: 0, retry: 0, claimLost: 0, blocked: 0, uncertain: 0, budgetExhausted: false };
  if (stopAt - Date.now() < 25_000) return { ...result, budgetExhausted: true };
  const { data, error } = await client.rpc("claim_message_file_cleanup_scoped", { p_limit: limit, ...(scope ? { p_user_id: scope.userId, p_message_id: scope.messageId } : {}) });
  if (error || !Array.isArray(data) || data.length > limit) throw new Error("Cleanup claim failed");
  const seen = new Set<string>();
  for (const item of data) {
    if (stopAt - Date.now() < 20_000) { result.budgetExhausted = true; break; }
    if (!item || !["message-audio", "message-videos", "message-photos", "message-documents"].includes(item.bucket)
      || typeof item.path !== "string" || !item.path.startsWith(`${item.user_id}/`)
      || item.path.split("/").some((part: string) => !part || part === "." || part === ".." || part.includes("\\"))
      || typeof item.claim_token !== "string") throw new Error("Invalid cleanup claim");
    if (scope && (item.user_id !== scope.userId || item.message_id !== scope.messageId)) throw new Error("Cleanup scope mismatch");
    const key = `${item.bucket}/${item.path}`;
    if (seen.has(key)) { result.blocked++; continue; }
    seen.add(key);
    const args = { p_message_id: item.message_id, p_bucket: item.bucket,
      p_path: item.path, p_token: item.claim_token };
    try {
      const before = await client.rpc("verify_message_file_cleanup", { ...args, p_phase: "before" });
      if (before.error) { result.uncertain++; continue; }
      if (before.data !== "ready") {
        if (before.data === "blocked") result.blocked++;
        else if (before.data === "lost") result.claimLost++;
        else result.uncertain++;
        continue;
      }
      // Even timeouts and empty provider responses are reconciled against Storage
      // metadata afterwards; never infer deletion solely from an SDK response.
      try { await client.storage.from(item.bucket).remove([item.path]); } catch { /* reconcile below */ }
      const after = await client.rpc("verify_message_file_cleanup", { ...args, p_phase: "after" });
      if (after.error) { result.uncertain++; continue; }
      if (after.data === "absent") result.removed++;
      else if (after.data === "blocked") result.blocked++;
      else if (after.data === "lost") result.claimLost++;
      else if (after.data === "present") {
        const finished = await client.rpc("finish_message_file_cleanup", { ...args, p_removed: false });
        if (finished.error || finished.data !== true) result.claimLost++;
        else result.retry++;
      } else result.uncertain++;
    } catch { result.uncertain++; }
  }
  return result;
}
