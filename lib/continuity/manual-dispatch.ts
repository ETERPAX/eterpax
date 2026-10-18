import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deliverContinuityEmails } from "./email";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGIN = "https://nfnkgvjehggrzlysvvhi.supabase.co";

export async function dispatchManualCheckIn(request: Request): Promise<Response> {
  const reply = (status: number, body: object) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });
  const secret = process.env.CONTINUITY_MANUAL_DISPATCH_SECRET;
  if (!secret || secret.length < 32 || /\s/.test(secret)) {
    return reply(503, { error: "Manual dispatch not configured" });
  }
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer \S+$/.test(authorization)
    || !timingSafeEqual(createHash("sha256").update(authorization).digest(),
      createHash("sha256").update(`Bearer ${secret}`).digest())) {
    return reply(401, { error: "Unauthorized" });
  }
  if (new URL(request.url).search || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !request.body) {
    return reply(400, { error: "Request parameters not supported" });
  }
  // Administrative authorization above is mandatory; userId only selects scope.
  let userId: string;
  const reader = request.body.getReader();
  const timeout = AbortSignal.timeout(5_000);
  const cancel = () => { void reader.cancel(); };
  timeout.addEventListener("abort", cancel, { once: true });
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (timeout.aborted) return reply(408, { error: "Request timed out" });
      if (done) break;
      size += value.length;
      if (size > 1024) { await reader.cancel(); return reply(413, { error: "Request too large" }); }
      chunks.push(value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).join(",") !== "userId"
      || typeof input.userId !== "string" || !UUID.test(input.userId)) {
      return reply(400, { error: "Exactly one valid userId is required" });
    }
    userId = input.userId.toLowerCase();
  } catch { return reply(400, { error: "Invalid request" }); }
  finally { timeout.removeEventListener("abort", cancel); reader.releaseLock(); }
  if (process.env.CONTINUITY_ENVIRONMENT !== "production"
    || process.env.SUPABASE_URL !== ORIGIN
    || process.env.NEXT_PUBLIC_SITE_URL !== "https://www.eterpax.com"
    || !process.env.SUPABASE_SECRET_KEY?.trim()) {
    return reply(503, { error: "Manual dispatch configuration invalid" });
  }
  try {
    const client = createClient(ORIGIN, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const delivery = await deliverContinuityEmails(client, "production", Date.now() + 45_000,
      { userId, limit: 2 });
    return reply(delivery.success ? 200 : 502, { delivery });
  } catch {
    return reply(502, { error: "Manual dispatch failed" });
  }
}
