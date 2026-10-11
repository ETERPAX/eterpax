import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { guardianVerificationOrigin, guardianVerificationQuestion } from "./guardian-verification-config";

function reply(status: number, outcome: string) {
  return Response.json({ outcome }, { status, headers: {
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
  } });
}

export async function submitGuardianVerificationResponse(request: Request): Promise<Response> {
  if (process.env.GUARDIAN_VERIFICATION_RESPONSE_ENABLED !== "true") return reply(503, "unavailable");
  try {
    const origin = guardianVerificationOrigin();
    guardianVerificationQuestion();
    if (request.method !== "POST" || request.headers.get("origin") !== origin
      || new URL(request.url).origin !== origin || new URL(request.url).search
      || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return reply(400, "unavailable");
    }
    // Bounded body; no logging of tokens or request contents. Slow clients are aborted.
    if (!request.body) return reply(400, "unavailable");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    const signal = AbortSignal.timeout(5_000);
    const cancel = () => { void reader.cancel(); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (signal.aborted) return reply(408, "unavailable");
        if (done) break;
        size += value.length;
        if (size > 1024) { await reader.cancel(); return reply(413, "unavailable"); }
        chunks.push(value);
      }
    } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return reply(400, "unavailable"); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, "unavailable");
    const { token, decision } = input as { token?: unknown; decision?: unknown };
    if (Object.keys(input).sort().join(",") !== "decision,token" || typeof token !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(token)
      || Buffer.from(token, "base64url").toString("base64url") !== token
      || (decision !== "positive" && decision !== "negative")) return reply(400, "unavailable");
    const environment = process.env.CONTINUITY_ENVIRONMENT;
    const hosts = { test: "xkojvvppactsabnewezb.supabase.co", production: "nfnkgvjehggrzlysvvhi.supabase.co" };
    if ((environment !== "test" && environment !== "production") || !process.env.SUPABASE_SECRET_KEY?.trim()) {
      return reply(503, "unavailable");
    }
    const target = new URL(process.env.SUPABASE_URL ?? "");
    if (target.origin !== `https://${hosts[environment]}` || target.username || target.password
      || target.pathname !== "/" || target.search || target.hash) return reply(503, "unavailable");
    const supabase = createClient(target.origin, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const digest = createHash("sha256").update(token, "utf8").digest("hex");
    const { data, error } = await supabase.rpc("submit_guardian_verification_response", {
      p_token_digest: `\\x${digest}`, p_decision: decision,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error) return reply(503, "unavailable");
    if (data === "recorded") return reply(200, "recorded");
    return reply(409, "unavailable");
  } catch { return reply(503, "unavailable"); }
}
