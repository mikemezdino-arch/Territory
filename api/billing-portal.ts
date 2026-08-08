import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { captureError } from "./_lib/sentry";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.STRIPE_SECRET_KEY) {
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

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!subscription?.stripe_customer_id) {
    res.status(400).json({ error: "No billing account on file yet — subscribe first." });
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${process.env.APP_URL}/app/account`,
    });
    res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error("billing portal session creation failed", err);
    captureError(err, { route: "billing-portal" });
    res.status(502).json({ error: "Could not open billing portal. Please retry." });
  }
}
