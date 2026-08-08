import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { captureError } from "./_lib/sentry";

// Required for signature verification: constructEvent needs the exact raw
// bytes Stripe signed, not a JSON.parse/re-stringify round-trip (which
// isn't guaranteed byte-identical — key order, whitespace, etc.). Disabling
// Vercel's automatic body parsing is what makes the raw stream available
// to read below. The local dev shim (vite.config.ts) mirrors this same
// opt-out for `npm run dev`.
export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// Stripe's Basil API version (2025-03-31+) moved current_period_end off the
// Subscription object entirely, onto its line items — a real breaking
// change that silently returns undefined on older code, not an error.
function currentPeriodEndIso(subscription: Stripe.Subscription): string | null {
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
}

function customerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    res.status(500).json({ error: "Server is missing Stripe configuration." });
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Server is missing Supabase configuration." });
    return;
  }

  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).json({ error: "Missing Stripe signature." });
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = await readRawBody(req);

  // The entire point of this endpoint existing behind signature
  // verification: a forged POST here (no valid signature) must never be
  // able to grant Studio access. Reject anything that doesn't provably
  // come from Stripe before touching the database at all.
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("stripe webhook signature verification failed", err);
    res.status(400).json({ error: "Invalid signature." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const custId = customerId(session.customer);
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
        if (!userId || !custId || !subscriptionId) {
          console.error("checkout.session.completed missing expected fields", {
            userId,
            custId,
            subscriptionId,
          });
          captureError(new Error("checkout.session.completed missing expected fields"), {
            route: "stripe-webhook",
            userId,
            custId,
            subscriptionId,
          });
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const { error } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: custId,
          stripe_subscription_id: subscriptionId,
          plan: "studio",
          current_period_end: currentPeriodEndIso(subscription),
        });
        if (error) throw error;
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const custId = customerId(subscription.customer);
        if (!custId) break;

        const isActive = subscription.status === "active" || subscription.status === "trialing";
        const { error } = await supabase
          .from("subscriptions")
          .update({
            stripe_subscription_id: subscription.id,
            plan: isActive ? "studio" : "free",
            current_period_end: currentPeriodEndIso(subscription),
          })
          .eq("stripe_customer_id", custId);
        if (error) throw error;
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const custId = customerId(subscription.customer);
        if (!custId) break;

        // Deliberately not setting plan: "free" here — a canceled
        // subscription already paid through its current period, and
        // isUserOnFreePlan's own current_period_end check is what naturally
        // drops access once that date passes. Flipping to free the instant
        // Stripe cancels would cut off access someone already paid for.
        const { error } = await supabase
          .from("subscriptions")
          .update({ current_period_end: currentPeriodEndIso(subscription) })
          .eq("stripe_customer_id", custId);
        if (error) throw error;
        break;
      }

      case "invoice.payment_failed":
        // Stripe's own dunning retries run first; only a subsequent
        // customer.subscription.updated/deleted (once Stripe gives up)
        // actually changes access. Logged for visibility, no state change
        // on the first failed charge.
        console.warn("invoice payment failed", (event.data.object as Stripe.Invoice).id);
        break;

      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("stripe webhook handling failed", err);
    captureError(err, { route: "stripe-webhook", eventType: event.type });
    res.status(500).json({ error: "Webhook handling failed." });
  }
}
