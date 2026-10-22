import Stripe from "stripe";
import { parsePlan } from "@/lib/billing/plans";
import { enabled, lifetimeCheckout, priceId as configuredPrice, verifyPrice } from "@/lib/billing/server";
import { guardianAdmin } from "@/lib/guardians/server";
import { createClient } from "@supabase/supabase-js";

let stripe: Stripe | undefined;

function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey?.trim()) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  stripe ??= new Stripe(secretKey);
  return stripe;
}

let supabase: ReturnType<typeof createClient> | undefined;

function getSupabase(): ReturnType<typeof createClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url?.trim() || !publishableKey?.trim()) {
    throw new Error("Missing Supabase configuration");
  }

  supabase ??= createClient(url, publishableKey);
  return supabase;
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = getSupabase();
    const accessToken = authorization.replace("Bearer ", "");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    let plan;
    try {
      const raw = await request.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "plan")) throw new Error("Invalid selection");
      plan = parsePlan(body.plan);
    } catch { return Response.json({ error: "Invalid plan selection" }, { status: 400 }); }
    if (!enabled(plan)) return Response.json({ error: "Plan unavailable" }, { status: 409 });
    const priceId = configuredPrice(plan);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

    if (!priceId || !siteUrl) {
      return Response.json(
        { error: "Missing Stripe configuration" },
        { status: 500 }
      );
    }

    if (plan === "lifetime") {
      const url = await lifetimeCheckout(getStripe(), guardianAdmin(), user.id, siteUrl);
      return Response.json({ url });
    }
    if (plan === "annual") await verifyPrice(getStripe(), plan);
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: user.email ?? undefined,
      metadata: {
        user_id: user.id,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
        },
      },
      success_url: `${siteUrl}/activate`,
      cancel_url: `${siteUrl}/payment`,
    });

    return Response.json({ url: session.url });
  } catch {
    // Provider errors may contain private customer data; do not log them.

    return Response.json(
      { error: "Unable to create checkout session" },
      { status: 500 }
    );
  }
}
