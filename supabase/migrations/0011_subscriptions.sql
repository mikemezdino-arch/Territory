-- Phase 6: subscriptions table, per spec §3. Stripe is the source of truth;
-- this is a local mirror kept in sync by the webhook (api/stripe-webhook.ts)
-- via the service-role key, which bypasses RLS entirely. The client only
-- ever reads its own row — same server-write-only trust pattern already
-- used for usage_counters. No insert/update/delete policy is intentional:
-- a user should never be able to grant themselves a plan by writing this
-- table directly.
create table subscriptions (
  user_id uuid primary key references auth.users,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free',   -- free | studio
  current_period_end timestamptz
);

alter table subscriptions enable row level security;

create policy "subscriptions_owner_select" on subscriptions
  for select using (user_id = auth.uid());
