import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plans, type Plan } from "./plans";

export const idOf = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
export function priceId(plan: Plan) {
  return process.env[plan === "monthly" ? "STRIPE_PRICE_ID" : plan === "annual" ? "STRIPE_ANNUAL_PRICE_ID" : "STRIPE_LIFETIME_PRICE_ID"]?.trim();
}
export function enabled(plan: Plan) {
  return !!priceId(plan) && (plan === "monthly" || process.env[plan === "annual" ? "ETERPAX_ANNUAL_ENABLED" : "ETERPAX_LIFETIME_ENABLED"] === "true");
}
function expectedLiveMode() {
  return process.env.VERCEL_ENV === "production" || process.env.STRIPE_BILLING_MODE !== "test";
}
export async function verifyPrice(stripe: Stripe, plan: "annual" | "lifetime") {
  const id = priceId(plan);
  if (!id) throw new Error("Plan unavailable");
  const price = await stripe.prices.retrieve(id);
  const monthly = await stripe.prices.retrieve(priceId("monthly")!);
  if (price.livemode !== expectedLiveMode() || !price.active || price.currency !== "usd" || price.unit_amount !== plans[plan].amount
    || idOf(price.product) !== idOf(monthly.product) || price.livemode !== monthly.livemode
    || (plan === "annual" ? price.type !== "recurring" || price.recurring?.interval !== "year" || price.recurring.interval_count !== 1
      : price.type !== "one_time")) throw new Error("Plan price mismatch");
  return id;
}
export async function rpc<T>(admin: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error("Billing persistence incomplete");
  return data as T;
}
type Reservation = { id: string; user_id: string; price_id: string; site_url: string; session_id: string | null; state: string; created_at: string; expires_at: string };

export async function lifetimeCheckout(stripe: Stripe, admin: SupabaseClient, userId: string, siteUrl: string) {
  const price = await verifyPrice(stripe, "lifetime");
  const reservation = await rpc<Reservation>(admin, "reserve_founder_slot", { p_user_id: userId, p_price_id: price, p_site_url: siteUrl });
  if (reservation.state === "granted") throw new Error("Lifetime already active");
  let session: Stripe.Checkout.Session;
  if (reservation.session_id) {
    session = await stripe.checkout.sessions.retrieve(reservation.session_id);
  } else {
    // Stable request parameters and key across retries. Never recreate after the
    // idempotency retention window or release an ambiguous creation by a timer.
    if (Date.now() - Date.parse(reservation.created_at) > 60 * 60 * 1000) throw new Error("Checkout requires reconciliation");
    session = await stripe.checkout.sessions.create({
      mode: "payment", payment_method_types: ["card"],
      line_items: [{ price: reservation.price_id, quantity: 1 }],
      client_reference_id: userId,
      metadata: { user_id: userId, plan: "lifetime", reservation_id: reservation.id },
      payment_intent_data: { metadata: { user_id: userId, reservation_id: reservation.id } },
      expires_at: Math.floor(Date.parse(reservation.expires_at) / 1000),
      success_url: `${reservation.site_url}/activate`, cancel_url: `${reservation.site_url}/payment`,
    }, { idempotencyKey: `founder-checkout-${reservation.id}` });
    await rpc(admin, "bind_founder_session", { p_reservation_id: reservation.id, p_session_id: session.id });
  }
  if (session.status === "expired") await reconcileLifetimeSession(stripe, admin, session.id, `reconcile:${session.id}`);
  if (session.status !== "open" || !session.url) throw new Error("Checkout is no longer open; refresh after reconciliation");
  return session.url;
}

// Called only after Stripe webhook signature verification. Always retrieve
// current payment state; old event payloads cannot grant or release inventory.
export async function handleLifetimeEvent(stripe: Stripe, admin: SupabaseClient, event: Stripe.Event): Promise<string | null> {
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) return null;
  const snapshot = event.data.object as Stripe.Checkout.Session;
  if (snapshot.mode !== "payment" || snapshot.metadata?.plan !== "lifetime") return null;
  return reconcileLifetimeSession(stripe, admin, snapshot.id, event.id);
}

async function reconcileLifetimeSession(stripe: Stripe, admin: SupabaseClient, sessionId: string, eventId: string): Promise<string | null> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent", "line_items"] });
  const rid = session.metadata?.reservation_id;
  const owner = session.metadata?.user_id;
  if (session.livemode !== expectedLiveMode() || !rid || !owner || session.mode !== "payment" || session.client_reference_id !== owner || session.metadata?.plan !== "lifetime") throw new Error("Invalid Lifetime identity");
  const reservation = await rpc<Reservation>(admin, "get_founder_reservation", { p_reservation_id: rid });
  const items = session.line_items;
  if (!reservation || reservation.user_id !== owner || (reservation.session_id && reservation.session_id !== session.id)
    || !items || items.has_more || items.data.length !== 1 || items.data[0].price?.id !== reservation.price_id || items.data[0].quantity !== 1) throw new Error("Lifetime checkout mismatch");
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  if (session.status === "complete" && session.payment_status === "paid") {
    if (!intent || intent.status !== "succeeded" || intent.currency !== "usd" || intent.amount_received !== 9999
      || session.currency !== "usd" || session.amount_total !== 9999 || session.livemode !== intent.livemode
      || intent.metadata.user_id !== owner || intent.metadata.reservation_id !== rid) throw new Error("Lifetime payment mismatch");
    await rpc(admin, "activate_founder_payment", { p_reservation_id: rid, p_session_id: session.id, p_payment_intent: intent.id, p_event_id: eventId });
    return owner;
  }
  // Failure alone is not terminal: card Checkout can be retried. Only a verified
  // expired session with no settled/in-flight intent can return its slot.
  if (session.status === "expired" && session.payment_status === "unpaid"
    && (!intent || intent.status === "canceled")) {
    await rpc(admin, "release_founder_slot", { p_reservation_id: rid, p_session_id: session.id, p_event_id: eventId });
  }
  return null;
}
