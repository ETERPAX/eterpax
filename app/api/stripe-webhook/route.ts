import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return Response.json(
      { error: "Missing Stripe webhook configuration" },
      { status: 400 }
    );
  }

  const body = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);

    return Response.json(
      { error: "Invalid webhook signature" },
      { status: 400 }
    );
  }

  switch (event.type) {
    case "checkout.session.completed": {
        const session = event.data.object;
      
        const userId = session.metadata?.user_id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
      
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;
      
        if (!userId || !subscriptionId) {
          console.error(
            "Stripe checkout completed without user_id or subscription_id:",
            session.id
          );
          break;
        }
      
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
      
        const priceId = subscription.items.data[0]?.price.id;
      
        if (!priceId) {
          console.error(
            "Stripe subscription has no price:",
            subscription.id
          );
          break;
        }
      
        const { error } = await supabase
          .from("subscriptions")
          .upsert(
            {
              user_id: userId,
              stripe_customer_id: customerId ?? null,
              stripe_subscription_id: subscription.id,
              stripe_price_id: priceId,
              status: subscription.status,
              current_period_start: new Date(
                subscription.items.data[0].current_period_start * 1000
              ).toISOString(),
              
              current_period_end: new Date(
                subscription.items.data[0].current_period_end * 1000
              ).toISOString(),
              cancel_at_period_end: subscription.cancel_at_period_end,
              canceled_at: subscription.canceled_at
                ? new Date(subscription.canceled_at * 1000).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "stripe_subscription_id",
            }
          );
      
        if (error) {
          console.error(
            "Supabase subscription upsert failed:",
            error
          );
          break;
        }
      
        console.log(
          "Stripe checkout completed and subscription saved:",
          subscription.id
        );
      
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
      
        const userId = subscription.metadata?.user_id;
        const subscriptionItem = subscription.items.data[0];
      
        if (!userId || !subscriptionItem) {
          console.error(
            "Stripe subscription updated without user_id or subscription item:",
            subscription.id
          );
          break;
        }
      
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
      
        const { error } = await supabase
          .from("subscriptions")
          .upsert(
            {
              user_id: userId,
              stripe_customer_id: customerId ?? null,
              stripe_subscription_id: subscription.id,
              stripe_price_id: subscriptionItem.price.id,
              status: subscription.status,
              current_period_start: new Date(
                subscriptionItem.current_period_start * 1000
              ).toISOString(),
              current_period_end: new Date(
                subscriptionItem.current_period_end * 1000
              ).toISOString(),
              cancel_at_period_end: subscription.cancel_at_period_end,
              canceled_at: subscription.canceled_at
                ? new Date(
                    subscription.canceled_at * 1000
                  ).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "stripe_subscription_id",
            }
          );
      
        if (error) {
          console.error(
            "Supabase subscription update failed:",
            error
          );
          break;
        }
      
        console.log(
          "Stripe subscription updated and saved:",
          subscription.id
        );
      
        break;
      }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;

      console.log("Stripe subscription deleted:", subscription.id);
      break;
    }

    default:
      console.log("Unhandled Stripe event:", event.type);
  }

  return Response.json({ received: true });
}