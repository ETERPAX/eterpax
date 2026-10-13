import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { recoverMessageFiles } from "./cleanup";

export async function executeMessageRecovery(request: Request, scheduled = false): Promise<Response> {
  const reply = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== (scheduled ? "GET" : "POST")) return reply(405, { error: "Method not allowed" });
  if (process.env.MESSAGE_RECOVERY_ENABLED !== "true") return reply(503, { error: "Recovery disabled" });
  if (scheduled && process.env.MESSAGE_RECOVERY_AUTOMATIC_ENABLED !== "true") return reply(503, { error: "Automatic recovery disabled" });
  const secret = scheduled ? process.env.CRON_SECRET : process.env.MESSAGE_RECOVERY_SECRET;
  if (!secret || secret.length < 32 || /\s/.test(secret)) return reply(503, { error: "Recovery not configured" });
  const header = request.headers.get("authorization");
  if (!header || !/^Bearer \S+$/.test(header) || !timingSafeEqual(
    createHash("sha256").update(header).digest(), createHash("sha256").update(`Bearer ${secret}`).digest(),
  )) return reply(401, { error: "Unauthorized" });
  if (new URL(request.url).search || request.body !== null) return reply(400, { error: "Parameters not supported" });
  // Credentials are server-only; use the same configured database as deletion.
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  try {
    const url = new URL(origin ?? "");
    if (!key?.trim() || url.origin !== origin || url.username || url.password
      || !(url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost")
      || !["http:", "https:"].includes(url.protocol)) throw new Error("Invalid recovery target");
  } catch { return reply(503, { error: "Recovery target invalid" }); }
  try {
    const client = createClient(origin!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error",
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000) }) },
    });
    const stopAt = Date.now() + 50_000;
    const summary = { ...await recoverMessageFiles(client, 2, stopAt - 6_000), finalized: 0, finalizationPending: 0, finalizationBlocked: 0 };
    if (stopAt - Date.now() >= 6_000) {
      const final = await client.rpc("finalize_message_deletion_batch", { p_limit: 10 });
      if (final.error || !Array.isArray(final.data)) summary.uncertain++;
      else for (const item of final.data) {
        if (item.outcome === "deleted") summary.finalized++;
        else if (item.outcome === "blocked") summary.finalizationBlocked++;
        else summary.finalizationPending++;
      }
    } else summary.budgetExhausted = true;
    console.info(JSON.stringify({ event: "message_file_recovery", ...summary }));
    return reply(summary.uncertain || summary.claimLost || summary.retry || summary.budgetExhausted ? 502 : 200, summary);
  } catch {
    console.info(JSON.stringify({ event: "message_file_recovery", outcome: "unknown" }));
    return reply(502, { error: "Recovery outcome unknown; inventory retained" });
  }
}
