import Stripe from "stripe";
import { guardianAdmin, sendGuardianConfirmations, uuidPattern } from "@/lib/guardians/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const idOf = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) return Response.json({ error: "Missing webhook configuration" }, { status: 400 });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret); }
  catch { return Response.json({ error: "Invalid webhook signature" }, { status: 400 }); }

  try {
    let subscriptionId: string | undefined;
    let checkoutOwner: string | undefined;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        subscriptionId = idOf(event.data.object.subscription);
        checkoutOwner = event.data.object.metadata?.user_id;
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        subscriptionId = event.data.object.id;
        break;
      case "invoice.paid":
        subscriptionId = idOf(event.data.object.parent?.subscription_details?.subscription);
        break;
      default: return Response.json({ received: true });
    }
    if (!subscriptionId) return Response.json({ received: true });
    // Never activate from a redirect or stale webhook snapshot. Retrieve current
    // Stripe state, including payment, before committing the activation gate.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] });
    const userId = subscription.metadata?.user_id;
    const item = subscription.items.data[0];
    if (!userId || !uuidPattern.test(userId) || !item || (checkoutOwner && checkoutOwner !== userId)) {
      return Response.json({ error: "Invalid subscription identity" }, { status: 400 });
    }
    const invoice = typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
    const paidAt = invoice?.status === "paid" ? invoice.status_transitions.paid_at : null;
    const activatedAt = subscription.status === "active" && paidAt ? new Date(paidAt * 1000).toISOString() : null;
    const admin = guardianAdmin();
    const { error } = await admin.rpc("sync_guardian_plan_subscription", {
      p_subscription: {
        user_id: userId, stripe_customer_id: idOf(subscription.customer) ?? null,
        stripe_subscription_id: subscription.id, stripe_price_id: item.price.id, status: subscription.status,
        current_period_start: new Date(item.current_period_start * 1000).toISOString(),
        current_period_end: new Date(item.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      p_activated_at: activatedAt,
    });
    if (error) throw new Error("Subscription persistence failed");
    if (activatedAt && !await sendGuardianConfirmations(admin, userId)) {
      // Stripe may retry; durable claims prevent another provider attempt.
      return Response.json({ error: "Notification processing incomplete" }, { status: 503 });
    }
    return Response.json({ received: true });
  } catch { return Response.json({ error: "Webhook processing incomplete" }, { status: 503 }); }
}
