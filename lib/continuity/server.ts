import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deliverContinuityEmails } from "./email";

const projectHosts = {
  test: "xkojvvppactsabnewezb.supabase.co",
  production: "nfnkgvjehggrzlysvvhi.supabase.co",
} as const;

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function invokeContinuityEngine(request: Request): Promise<Response> {
  // Next.js can dispatch HEAD through GET; it must never trigger processing.
  if (request.method !== "GET") {
    return reply(405, { success: false, error: "Method not allowed" });
  }

  if (process.env.CONTINUITY_SCHEDULER_ENABLED !== "true") {
    return reply(503, { success: false, error: "Scheduler disabled" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret?.trim() || /\s/.test(cronSecret)) {
    return reply(503, { success: false, error: "Scheduler configuration invalid" });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer \S+$/.test(authorization)) {
    return reply(401, { success: false, error: "Unauthorized" });
  }

  // Compare fixed-length digests without exposing either credential.
  const supplied = createHash("sha256").update(authorization).digest();
  const expected = createHash("sha256").update(`Bearer ${cronSecret}`).digest();
  if (!timingSafeEqual(supplied, expected)) {
    return reply(401, { success: false, error: "Unauthorized" });
  }

  // This endpoint has no request-supplied configuration or RPC arguments.
  if (new URL(request.url).search || request.body !== null) {
    return reply(400, { success: false, error: "Request parameters not supported" });
  }

  const environment = process.env.CONTINUITY_ENVIRONMENT;
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (
    (environment !== "test" && environment !== "production") ||
    !supabaseUrl || !secretKey?.trim()
  ) {
    return reply(503, { success: false, error: "Scheduler configuration invalid" });
  }

  let target: URL;
  try {
    target = new URL(supabaseUrl);
  } catch {
    return reply(503, { success: false, error: "Scheduler configuration invalid" });
  }

  if (
    target.protocol !== "https:" ||
    target.hostname !== projectHosts[environment] ||
    target.port || target.username || target.password ||
    target.pathname !== "/" || target.search || target.hash
  ) {
    return reply(503, { success: false, error: "Scheduler configuration invalid" });
  }

  const deliveryStopAt = Date.now() + 45_000;
  try {
    const supabase = createClient(target.origin, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc("process_continuity_engine");
    if (error || !Array.isArray(data) || data.length > 100) {
      return reply(502, { success: false, error: "Engine invocation failed" });
    }

    // Engine success is independent of delivery. Never rerun it on email failure.
    try {
      const delivery = await deliverContinuityEmails(supabase, environment, deliveryStopAt);
      return reply(200, { success: true, transitions: data.length, delivery });
    } catch {
      return reply(200, { success: true, transitions: data.length,
        delivery: { success: false, code: "DELIVERY_FAILED" } });
    }
  } catch {
    return reply(502, { success: false, error: "Engine invocation failed" });
  }
}
