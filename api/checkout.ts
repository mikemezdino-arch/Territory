import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID_STUDIO) {
    res.status(500).json({ error: "Server is missing Stripe configuration." });
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Server is missing Supabase configuration." });
    return;
  }
  if (!process.env.APP_URL) {
    res.status(500).json({ error: "Server is missing APP_URL." });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Reuse an existing Stripe customer if this user has one on file (e.g.
  // re-subscribing after a cancellation) — Stripe's API rejects passing
  // both `customer` and `customer_email` on the same session, so this is
  // an either/or based on what's already in our local mirror.
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: user.id,
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email }),
      line_items: [{ price: process.env.STRIPE_PRICE_ID_STUDIO, quantity: 1 }],
      success_url: `${process.env.APP_URL}/app/account?upgraded=1`,
      cancel_url: `${process.env.APP_URL}/app/account`,
    });

    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("checkout session creation failed", err);
    res.status(502).json({ error: "Could not start checkout. Please retry." });
  }
}
