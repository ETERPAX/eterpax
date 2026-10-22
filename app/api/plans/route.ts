import Stripe from "stripe";
import { enabled, verifyPrice, rpc } from "@/lib/billing/server";
import { guardianAdmin } from "@/lib/guardians/server";

export const dynamic = "force-dynamic";
export async function GET() {
  const available = { monthly: enabled("monthly"), annual: false, lifetime: false };
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) {
    const stripe = new Stripe(key);
    if (enabled("annual")) {
      try { await verifyPrice(stripe, "annual"); available.annual = true; } catch { /* Closed until correctly configured. */ }
    }
    if (enabled("lifetime")) {
      try {
        await verifyPrice(stripe, "lifetime");
        available.lifetime = await rpc<boolean>(guardianAdmin(), "founder_sales_available");
      } catch { /* No availability promise before migration/configuration. */ }
    }
  }
  return Response.json(available, { headers: { "Cache-Control": "no-store" } });
}
