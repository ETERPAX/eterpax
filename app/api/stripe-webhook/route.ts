import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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

      console.log("Stripe checkout completed:", session.id);
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;

      console.log("Stripe subscription updated:", subscription.id);
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