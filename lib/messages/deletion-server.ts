import "server-only";
import { recoverMessageFiles } from "./cleanup";
import { createClient } from "@supabase/supabase-js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleMessageDeletion(request: Request) {
  const stopAt = Date.now() + 50_000;
  const reply = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!["GET", "POST"].includes(request.method)) return reply(405, { error: "Method not allowed" });
  if (process.env.MESSAGE_DELETE_ENABLED !== "true") return reply(403, { enabled: false });
  if (new URL(request.url).search) return reply(400, { error: "Parameters not supported" });
  const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i);
  if (!bearer) return reply(401, { error: "Unauthorized" });
  const origin = process.env.SUPABASE_URL;
  try {
    const url = new URL(origin ?? "");
    if (!process.env.SUPABASE_SECRET_KEY?.trim() || url.origin !== origin || url.username || url.password
      || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Invalid target");
  } catch { return reply(503, { error: "Deletion not configured" }); }
  try {
    const admin = createClient(origin!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error",
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000) }) },
    });
    const auth = await admin.auth.getUser(bearer[1]);
    if (auth.error || !auth.data.user) return reply(401, { error: "Unauthorized" });
    const rollout = await admin.from("message_file_settings").select("coordination_enabled,delete_enabled,private_delivery_reviewed_disabled").eq("singleton", true).maybeSingle();
    if (rollout.error || !rollout.data?.coordination_enabled || !rollout.data.delete_enabled || !rollout.data.private_delivery_reviewed_disabled) return reply(403, { enabled: false });
    if (request.method === "GET") {
      const pending = await admin.from("message_deletion_requests").select("message_id").eq("user_id", auth.data.user.id).is("finalized_at", null).limit(100);
      if (pending.error) return reply(503, { error: "Deletion status unavailable" });
      return reply(200, { enabled: true, pending: pending.data });
    }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Invalid request" });
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["messageId", "action", "confirmed"].includes(key)) || typeof input.messageId !== "string" || !uuid.test(input.messageId)
      || !["delete", "check"].includes(input.action as string) || (input.action === "delete" && input.confirmed !== true)) return reply(400, { error: "Explicit confirmation required" });
    // User identity is derived only from validated authentication, never the payload.
    const args = { p_user_id: auth.data.user.id, p_message_id: input.messageId };
    if (input.action === "delete") {
      const start = await admin.rpc("request_message_deletion", args);
      if (start.error) return reply(start.error.code === "P0001" ? 409 : 503, {
        outcome: start.error.code === "P0001" ? "blocked" : "unknown",
        error: start.error.code === "P0001" ? "Message unavailable or continuity/delivery safety check blocked deletion." : "Result uncertain. Check deletion status before retrying.",
      });
    }
    // An authenticated click processes at most two files of this message only.
    // Check resumes the same durable inventory; it never starts another deletion.
    const initial = await admin.rpc("finalize_message_deletion", args);
    if (initial.error) return reply(503, { error: "Result uncertain. Check deletion status before retrying." });
    if (initial.data === "deleted" || initial.data === "blocked") return reply(initial.data === "blocked" ? 409 : 200, { outcome: initial.data });
    if (initial.data !== "pending") return reply(503, { error: "Invalid deletion result" });
    try {
      await recoverMessageFiles(admin, 2, stopAt - 5_000, { userId: auth.data.user.id, messageId: input.messageId });
    } catch { /* Preserve inventory and reconcile; never repeat an uncertain removal inline. */ }
    const final = await admin.rpc("finalize_message_deletion", args);
    if (final.error) return reply(503, { error: "Result uncertain. Check deletion status before retrying." });
    if (!["deleted", "pending", "blocked"].includes(final.data)) return reply(503, { error: "Invalid deletion result" });
    return reply(final.data === "blocked" ? 409 : 200, { outcome: final.data });
  } catch { return reply(503, { error: "Result uncertain. Check deletion status before retrying." }); }
}
