import type { SupabaseClient } from "@supabase/supabase-js";
export async function messageCoordinationEnabled(client: SupabaseClient): Promise<boolean> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Error("Please sign in again.");
  const state = await client.rpc("message_coordination_enabled", { p_user_id: user.id });
  // Pre-migration deployment remains compatible. All other failures stop writes.
  if (state.error?.code === "PGRST202") return false;
  if (state.error || typeof state.data !== "boolean") throw new Error("Unable to verify upload mode.");
  return state.data;
}
