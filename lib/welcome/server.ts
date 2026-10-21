import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { welcomeEmail } from "./email";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Durable reservation precedes every provider call. Ambiguous sends are never retried. */
export async function sendPendingWelcomes(client: SupabaseClient, resend: Resend, stopAt: number) {
  const counts = { accepted: 0, uncertain: 0, invalid: 0, error: 0 };
  for (let index = 0; index < 3 && Date.now() + 22_000 < stopAt; index++) {
    try {
      const claim = await client.rpc("claim_welcome_email").abortSignal(AbortSignal.timeout(5_000));
      if (claim.error || !Array.isArray(claim.data) || claim.data.length > 1) { counts.error++; break; }
      if (!claim.data.length) break;
      const row = claim.data[0];
      if (!row || typeof row.user_id !== "string" || !uuid.test(row.user_id)
        || typeof row.claim_token !== "string" || !uuid.test(row.claim_token)) { counts.error++; break; }
      let status: "accepted" | "uncertain" | "invalid" = "invalid";
      if (typeof row.email === "string" && row.email.length <= 254
        && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(row.email)
        && typeof row.first_name === "string" && row.first_name.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim()) {
        const email = welcomeEmail(row.first_name);
        status = "uncertain";
        try {
          const options: Parameters<typeof resend.emails.send>[1] & { signal: AbortSignal } = {
            idempotencyKey: `eterpax:welcome:${row.user_id}`, signal: AbortSignal.timeout(10_000),
          };
          const result = await resend.emails.send({ from: "ETERPAX <hello@eterpax.com>", to: row.email, ...email }, options);
          if (!result.error && result.data?.id) status = "accepted";
        } catch { /* Unknown provider outcome: preserve reservation, no automatic retry. */ }
      }
      const finished = await client.rpc("finish_welcome_email", {
        p_user_id: row.user_id, p_claim_token: row.claim_token, p_status: status,
      }).abortSignal(AbortSignal.timeout(5_000));
      if (finished.error || finished.data !== true) counts.error++;
      else counts[status]++;
    } catch { counts.error++; break; } // Never log provider/DB errors or account data.
  }
  return counts;
}

export async function runWelcomeEmails(request: Request) {
  const reply = (status: number, body: object) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret?.trim() || !timingSafeEqual(createHash("sha256").update(authorization).digest(),
    createHash("sha256").update(`Bearer ${secret}`).digest())) return reply(401, { error: "Unauthorized" });
  if (request.method !== "GET" || new URL(request.url).search || request.body) return reply(400, { error: "Invalid request" });
  // Match existing senders: the SDK may log raw errors in development.
  if (process.env.NODE_ENV !== "production" || !process.env.RESEND_API_KEY?.trim()
    || !process.env.SUPABASE_SECRET_KEY?.trim() || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return reply(503, { error: "Welcome email unavailable" });
  }
  try {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const resend = new Resend(process.env.RESEND_API_KEY, { baseUrl: "https://api.resend.com" });
    const counts = await sendPendingWelcomes(client, resend, Date.now() + 55_000);
    return reply(counts.error + counts.uncertain + counts.invalid ? 502 : 200, { counts });
  } catch { return reply(502, { error: "Welcome email outcome unavailable" }); }
}
