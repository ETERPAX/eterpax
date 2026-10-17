import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

async function preparePendingVerifications(supabase: SupabaseClient, stopAt: number) {
  const outcomes = { prepared: 0, already_prepared: 0, ineligible: 0, dispatch_expired: 0 };
  const error_categories = { configuration_or_permission: 0, rpc_rejected: 0,
    invalid_response: 0, transport_uncertain: 0, unexpected_error: 0 };
  type Category = keyof typeof error_categories;
  const summary = { success: true, attempted: 0, errors: 0, remote_outcome_uncertain: 0,
    error_categories, budget_exhausted: false, outcomes };
  const record = (category: Category, uncertain = false) => {
    summary.errors++;
    error_categories[category]++;
    if (uncertain) summary.remote_outcome_uncertain++;
  };
  // Inspect codes/status only; never expose provider text or identifying data.
  const classify = (error: unknown, status?: number): Category => {
    const e = error as { code?: string; name?: string } | null;
    const code = typeof e?.code === "string" ? e.code : "";
    if ([401, 403, 404].includes(status ?? 0)
      || ["42501", "42883", "42P01", "42703", "3F000"].includes(code)
      || ["PGRST106", "PGRST200", "PGRST201", "PGRST202", "PGRST204",
        "PGRST205", "PGRST301", "PGRST302", "PGRST303"].includes(code)) return "configuration_or_permission";
    if (code.startsWith("08")) return "transport_uncertain";
    if (/^[0-9A-Z]{5}$/.test(code)) return "rpc_rejected";
    if (status === 0 || (status !== undefined && status >= 500)
      || e?.name === "AbortError" || e?.name === "TimeoutError"
      || e?.name === "TypeError") return "transport_uncertain";
    return "unexpected_error";
  };
  const remaining = () => Math.max(0, stopAt - Date.now());
  try {
    if (!remaining()) {
      summary.budget_exhausted = true;
      summary.success = false;
      return summary;
    }
    // Anti-join includes old pending work, not just this engine invocation.
    // The RPC alone decides eligibility under parent-first locks.
    const { data, error, status } = await supabase.from("guardian_escalations")
      .select("id,guardian_verification_rounds(escalation_id)")
      .eq("status", "waiting_for_responses")
      .is("guardian_verification_rounds", null)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(20).abortSignal(AbortSignal.timeout(remaining() || 1));
    if (error) {
      record(classify(error, status));
    } else if (!Array.isArray(data) || data.length > 20) {
      record("invalid_response");
    } else {
      for (const candidate of data) {
        if (!remaining()) {
          summary.budget_exhausted = true;
          break;
        }
        let invoked = false;
        try {
          if (typeof candidate?.id !== "string") {
            record("invalid_response");
            continue;
          }
          summary.attempted++;
          invoked = true;
          const result = await supabase.rpc("prepare_guardian_verification", {
            p_escalation_id: candidate.id,
          }).abortSignal(AbortSignal.timeout(remaining() || 1));
          if (result.error) {
            const category = classify(result.error, result.status);
            record(category, category === "transport_uncertain" || category === "unexpected_error");
            continue;
          }
          const row = result.data?.[0];
          if (!Array.isArray(result.data) || result.data.length !== 1
            || row?.escalation_id !== candidate.id
            || !Object.prototype.hasOwnProperty.call(outcomes, row?.outcome)) {
            record("invalid_response", true);
            continue;
          }
          outcomes[row.outcome as keyof typeof outcomes]++;
        } catch (error) {
          // A thrown request may have committed; this is not a remote rollback.
          record(classify(error), invoked);
        }
      }
    }
  } catch (error) {
    // Selection is read-only, so it cannot leave an uncertain preparation.
    record(classify(error));
  }
  summary.budget_exhausted ||= remaining() === 0;
  summary.success = summary.errors === 0 && !summary.budget_exhausted
    && outcomes.dispatch_expired === 0;
  // Monitoring must inspect preparation.success/categories, not HTTP success:
  // engine success remains independent and must not trigger an engine retry.
  // Counts only: no provider calls, credentials, payloads or raw errors.
  // dispatch_expired requires a separately authorized operational-state writer.
  return summary;
}

// Abort only stops our wait; a remote transaction may already have committed.
async function runEngine(supabase: SupabaseClient) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(supabase.rpc("process_continuity_engine").abortSignal(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("ENGINE_OUTCOME_UNKNOWN")); }, 10_000);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
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

  const startedAt = Date.now();
  const requestStopAt = startedAt + 55_000;
  const log = (outcome: string, transitions = 0) => console.info(JSON.stringify({
    event: "continuity_scheduler", outcome, transitions, elapsed_ms: Date.now() - startedAt,
  }));
  try {
    const supabase = createClient(target.origin, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await runEngine(supabase);
    if (error || !Array.isArray(data) || data.length > 100) {
      log("engine_outcome_unknown");
      return reply(502, { success: false, error: "Engine invocation failed", code: "ENGINE_OUTCOME_UNKNOWN" });
    }

    log("engine_completed", data.length);
    const deliveryStopAt = Math.min(Date.now() + 45_000, requestStopAt);

    // Opt-in only: preparation starts the 24-hour operational deadline.
    const preparation = process.env.GUARDIAN_VERIFICATION_PREPARATION_ENABLED === "true"
      ? { preparation: await preparePendingVerifications(supabase, Math.min(Date.now() + 5_000, deliveryStopAt)) }
      : {};

    // Engine success is independent of preparation and delivery; never rerun it.
    try {
      const delivery = await deliverContinuityEmails(supabase, environment, deliveryStopAt);
      let guardianVerification = {};
      if (process.env.GUARDIAN_VERIFICATION_AUTOMATIC_ENABLED === "true") {
        try {
          const { deliverPendingGuardianVerifications } = await import("./guardian-verification-dispatch");
          guardianVerification = { guardianVerification: await deliverPendingGuardianVerifications(supabase, environment, deliveryStopAt) };
        } catch {
          guardianVerification = { guardianVerification: { outcome: "worker_failed" } };
        }
      }
      log(delivery.success ? "delivery_completed" : "delivery_incomplete", data.length);
      return reply(200, { success: true, transitions: data.length, ...preparation, delivery, ...guardianVerification });
    } catch {
      log("delivery_failed", data.length);
      return reply(200, { success: true, transitions: data.length, ...preparation,
        delivery: { success: false, code: "DELIVERY_FAILED" } });
    }
  } catch {
    log("engine_outcome_unknown");
      return reply(502, { success: false, error: "Engine invocation failed", code: "ENGINE_OUTCOME_UNKNOWN" });
  }
}
