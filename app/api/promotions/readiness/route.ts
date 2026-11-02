import { guardianAdmin } from "@/lib/guardians/server";
import { secretMatches } from "@/lib/recipient-delivery/core";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!secretMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) return reply({ error: "Unauthorized" }, 401);
  if (new URL(request.url).search || request.body) return reply({ error: "Invalid request" }, 400);
  try {
    const { data, error } = await guardianAdmin().rpc("social_promotion_readiness").abortSignal(AbortSignal.timeout(5000));
    if (error || data?.policy_version !== "read_only_finish_started_cycles_v1") return reply({ compatible: false }, 503);
    return reply({ compatible: true, revision: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      redemption_enabled: process.env.SOCIAL_PROMOTION_ENABLED === "true",
      notices_enabled: process.env.PROMOTION_EXPIRY_NOTICES_ENABLED === "true", database: data });
  } catch { return reply({ compatible: false }, 503); }
}
