import { supabase } from "@/lib/supabase";

export type Guardian = { id?: string; name: string; email: string; relationship: string };

async function request(method: "GET" | "POST", body?: unknown) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Please sign in again.");
  const response = await fetch("/api/guardians", {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Unable to load Guardians.");
  return result as { guardians: Guardian[]; active: boolean; notificationsComplete: boolean };
}

export async function loadGuardians() { return (await request("GET")).guardians; }
export function saveGuardians(guardians: Guardian[], existingIds: string[]) {
  return request("POST", { existingIds, guardians: guardians.map(({ id, name, email, relationship }) => ({ id: id ?? null, name, email, relationship })) });
}
