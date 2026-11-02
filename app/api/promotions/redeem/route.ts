import { authenticateOwner, guardianAdmin } from "@/lib/guardians/server";
import { promotionDigest } from "@/lib/promotions/code";

export const runtime = "nodejs";
const reply = (status: string, httpStatus = 200) => Response.json({ status }, {
  status: httpStatus, headers: { "Cache-Control": "no-store" },
});

export async function POST(request: Request) {
  try {
    const user = await authenticateOwner(request);
    if (!user) return reply("unauthorized", 401);
    if (!user.email_confirmed_at) return reply("unverified", 403);
    if (process.env.SOCIAL_PROMOTION_ENABLED !== "true") return reply("unavailable", 503);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply("invalid", 415);
    // Bound the actual body, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply("invalid", 400);
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512) { await reader.cancel(); return reply("invalid", 413); }
      chunks.push(chunk.value);
    }
    let digest: string | null = null;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1) {
        digest = promotionDigest(body.code);
      }
    } catch { /* Malformed attempts still consume the durable account budget. */ }
    const { data, error } = await guardianAdmin().rpc("redeem_social_promotion", {
      p_user_id: user.id, p_digest: digest,
    });
    if (error || !data || typeof data.status !== "string") return reply("unavailable", 503);
    switch (data.status) {
      case "success": return reply("success");
      case "rate_limited": return reply("rate_limited", 429);
      case "invalid": return reply("invalid", 400);
      case "used": return reply("used", 409);
      case "ineligible": return reply("ineligible", 403);
      default: return reply("unavailable", 503);
    }
  } catch { return reply("unavailable", 503); }
}
