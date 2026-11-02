import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { promotionExpiryEmail } from "./expiry-email";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function sendPromotionExpiryNotices(client: SupabaseClient, resend: Resend, stopAt: number) {
  const counts = { accepted: 0, uncertain: 0, invalid: 0, error: 0 };
  for (let i = 0; i < 3 && Date.now() + 22_000 < stopAt; i++) {
    try {
      const claim = await client.rpc("claim_promotion_expiry_notice").abortSignal(AbortSignal.timeout(5_000));
      if (claim.error || !Array.isArray(claim.data) || claim.data.length > 1) { counts.error++; break; }
      if (!claim.data.length) break;
      const row = claim.data[0];
      if (!row || !uuid.test(row.user_id) || !uuid.test(row.claim_token) || ![30, 7].includes(row.days_before)) { counts.error++; break; }
      let status: "accepted" | "uncertain" | "invalid" = "invalid";
      let providerId: string | null = null;
      if (typeof row.email === "string" && row.email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(row.email)
        && typeof row.expires_at === "string" && Number.isFinite(Date.parse(row.expires_at))) {
        const email = promotionExpiryEmail(row.expires_at, row.days_before);
        status = "uncertain";
        try {
          const options: Parameters<typeof resend.emails.send>[1] & { signal: AbortSignal } = {
            idempotencyKey: `eterpax:promotion-expiry:${row.user_id}:${row.days_before}`, signal: AbortSignal.timeout(10_000),
          };
          const result = await resend.emails.send({ from: "ETERPAX <hello@eterpax.com>", to: row.email, ...email }, options);
          if (!result.error && result.data?.id) { status = "accepted"; providerId = result.data.id; }
        } catch { /* Durable reservation remains spent; never retry an uncertain send. */ }
      }
      const finish = await client.rpc("finish_promotion_expiry_notice", {
        p_user_id: row.user_id, p_days: row.days_before, p_claim: row.claim_token, p_status: status, p_provider_id: providerId,
      }).abortSignal(AbortSignal.timeout(5_000));
      if (finish.error || finish.data !== true) counts.error++; else counts[status]++;
    } catch { counts.error++; break; }
  }
  return counts;
}

export async function runPromotionExpiryNotices(request: Request) {
  const reply = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim() || !timingSafeEqual(createHash("sha256").update(request.headers.get("authorization") ?? "").digest(),
    createHash("sha256").update(`Bearer ${secret}`).digest())) return reply(401, { error: "Unauthorized" });
  if (request.method !== "GET" || new URL(request.url).search || request.body) return reply(400, { error: "Invalid request" });
  if (process.env.PROMOTION_EXPIRY_NOTICES_ENABLED !== "true" || process.env.NODE_ENV !== "production"
    || !process.env.RESEND_API_KEY?.trim() || !process.env.SUPABASE_SECRET_KEY?.trim() || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return reply(503, { error: "Promotion notices disabled or unavailable" });
  }
  try {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const counts = await sendPromotionExpiryNotices(client, new Resend(process.env.RESEND_API_KEY, { baseUrl: "https://api.resend.com" }), Date.now() + 55_000);
    return reply(counts.error + counts.uncertain + counts.invalid ? 502 : 200, { counts });
  } catch { return reply(502, { error: "Notice outcome unavailable; inspect persistent state" }); }
}
