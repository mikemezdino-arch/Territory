# Territory — Rollout Plan (Phase 6 and beyond)

`TERRITORY_BUILD_SPEC.md` only defines through Phase 6 (Billing). This
document picks up from there: what Phase 6 actually involves in detail, two
further phases the original spec never covered, a pricing check against the
live market, the hosting/security/scaling plan, and what it takes to run
this as a real, legally-separate business. It does not replace or edit the
original spec — treat it as the addendum for everything after Phase 5.

Prepared August 2026. Pricing and vendor-cost figures below reflect
live research as of that date (Anthropic, fal.ai, ElevenLabs, Supabase,
Vercel, and named competitors' own pricing pages) — re-check before
finalizing the Studio price at launch. The Operations section is general,
well-established practice, not a substitute for advice from a licensed
attorney or accountant.

---

## Free tier lockdown — now backed by real billing, not a placeholder

The free-tier restrictions below shipped first against a hard-coded
placeholder (`IS_FREE_PLAN = true` for everyone), specifically so the UX
and paywall triggers could be proven out before Stripe entered the
picture. That constant is gone now — Phase 6 replaced it with a real
per-user lookup:

- **`src/hooks/usePlan.ts`** + **`src/context/PlanProvider.tsx`** — one
  real `subscriptions` query per app session (not per page; every `/app/*`
  page renders under the same `AppLayout`, which mounts the provider
  once), exposing `{ isFreePlan, loading, refreshPlan }`. Server-side,
  **`api/_lib/plan.ts`**'s `isUserOnFreePlan()` does the equivalent lookup
  for `api/panel.ts`'s quality gate and `api/_lib/creditCap.ts`'s limit
  selection. `src/lib/plan.ts` now holds only `FREE_TIER_MAX_TERRITORIES`
  (`1`) — the one gate constant that isn't itself a plan lookup.
- **One territory per free-tier user.** `TerritoriesPage.tsx`'s
  `chooseTerritory()` blocks choosing a second territory once one is
  already selected, showing the upgrade modal instead. (Multiple territories
  in parallel remains a Studio feature — the underlying multi-territory
  routes/schema aren't touched, just gated.)
- **No MP4 or Pitch PDF export.** Gated at both entry points: the Board
  page's "Export →" link always opens the upgrade modal for free-tier
  users instead of navigating to the Export page, and `ExportPage.tsx`'s
  `handleRenderMp4` / `handleRenderPdf` short-circuit to the same modal
  instead of rendering, in case a free user reaches that page directly.
  The Export page's own MP4/Pitch PDF buttons stay labeled with a lock so
  the feature is discoverable there; the Board page's "Export →" link
  deliberately isn't — it reads as an inviting call-to-action rather than
  something visibly blocked, since clicking it always opens the modal
  regardless.
- **No higher-quality image rendering.** Gated in two places, deliberately:
  the Board page's "Higher quality" checkbox won't check itself for
  free-tier users (opens the modal instead), and `api/panel.ts` independently
  forces `quality: "high"` off server-side regardless of what the client
  sends — the client-side gate is a UX nicety, the server-side one is the
  actual enforcement.
- **`UpgradeModal`** (`src/components/UpgradeModal.tsx`) — the shared
  paywall dialog all four gates open, listing the full set of features
  Studio unlocks (not just the one that triggered it). Its CTA now creates
  a real Stripe Checkout session via `api/checkout.ts` and redirects to
  it — no longer the inert "coming soon" placeholder.
- **A persistent "Subscribe" pill** in the upper-right corner of every
  `/app/*` page (`AppLayout.tsx`'s `TopBar`, so it's global rather than
  duplicated per page) opens the same modal with no specific triggering
  feature — it falls back to a generic "Territory Studio ($29/mo)
  unlocks:" heading, and now correctly disappears once `usePlan()` reports
  a real Studio subscription instead of always showing.

The only thing standing between this and real paying customers is Stripe
account setup itself (test keys today, live keys + the production domain
before launch) — see "Phase 6 setup — Stripe" in the README. No code path
left is fake or placeholder.

---

## Phase 6 — Billing

Turn the free/paid split from a constant into a real subscription. **Built.**
What's left is Stripe account setup (test keys to develop against, live
keys + the production domain before real launch) — see the README's
"Phase 6 setup — Stripe" section for the concrete steps.

**Dependencies — all satisfied**
- ~~Stripe account in test mode; product + one price ($29/mo Studio)~~ — your action item, not a code dependency; the code just reads whatever `STRIPE_PRICE_ID_STUDIO` you configure
- `STRIPE_*` env vars — documented in `.env.local.example` with setup steps, no longer placeholders
- `subscriptions` table — migrated (`0011_subscriptions.sql`)
- `checkAndIncrementUsage()` — extended, not replaced; picks free/studio limits via `isUserOnFreePlan()`
- `src/lib/plan.ts` gates — extended, not replaced; `FREE_TIER_MAX_TERRITORIES` is the only constant left there

**Action items — all built**
- ✅ Migration: `subscriptions` table + RLS (owner-only select)
- ✅ `api/checkout.ts` — creates a Stripe Checkout session for the signed-in user
- ✅ `api/stripe-webhook.ts` — handles `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`, with signature verification against
  `STRIPE_WEBHOOK_SECRET` on every request (see Abuse prevention below —
  this was the highest-severity item in this whole plan, built in from
  line one, not bolted on after)
- ✅ Real per-user plan lookup: `src/hooks/usePlan.ts` (client, via
  `PlanProvider`) and `api/_lib/plan.ts`'s `isUserOnFreePlan()` (server)
  both check `plan = 'studio' AND current_period_end > now()`, not just
  the plan string — the date check is what protects access through a
  webhook that's delayed or dropped
- ✅ `creditCap.ts` now picks free (30/40/5) vs studio (200/100/20) limits
  via the same server-side lookup
- ✅ `UpgradeModal`'s CTA creates a real Checkout session and redirects to it
- ✅ `/app/account` — current plan, today's usage against the cap, "Manage
  billing" opens a real Stripe billing-portal session via
  `api/billing-portal.ts`
- ⬜ Buy the production domain and point it at Vercel (see Infrastructure
  below) — Stripe Checkout redirects, receipts, and Supabase's auth
  redirect URL all need a real `APP_URL` before this goes live, not a
  `*.vercel.app` address. Still your action item — nothing to build here.

**Checkpoint** — see the README's "Phase 6 checkpoint" for the full
click-through. Short version: a test-mode Stripe upgrade actually raises
the caps, unlocks a second territory, removes the export lock, and
unlocks higher-quality rendering, app-wide, without a page refresh;
canceling in the billing portal drops back to free at period end, not
immediately.

### Free vs. Studio, in full

| Dimension | Free | Studio — $29/mo |
|---|---|---|
| Projects | 1 | Unlimited |
| LLM calls/day (territory, beats, custom analysis) | 30 | 200 |
| Image calls/day (panels) | 40 | 100 |
| TTS calls/day (voiceover) | 5 | 20 |
| Territories per project | **1** | Unlimited |
| MP4 export | **Locked** | Included |
| Pitch PDF export | **Locked** | Included |
| Higher-quality image model | **Locked** | Included |
| Export watermark | N/A — exports locked entirely | None |
| Music beds, voice selection | Included | Included |
| Territory regenerations | 2/project | 2/project |
| Support | Self-serve | Priority email |

"Unlimited projects" on Studio isn't a loophole — creating a project costs
nothing by itself; every dollar of vendor spend is gated by the per-day
call caps, which apply no matter how calls are split across projects. A
separate project-count cap would just add a second, redundant ceiling.

### How "who's subscribed" gets tracked

Stripe is the source of truth, not a flag set by hand. `subscriptions` is a
local mirror kept in sync by the webhook:

- `checkout.session.completed` → insert/update: `plan = 'studio'`,
  `stripe_customer_id`, `stripe_subscription_id`, `current_period_end`
- `customer.subscription.updated` → refresh `current_period_end` on renewal
- `customer.subscription.deleted` → set `plan = 'free'`, but only once
  `current_period_end` has passed — a mid-cycle cancellation keeps Studio
  access through the period already paid for
- `invoice.payment_failed` → Stripe's own dunning retries run first; only
  flip to free after Stripe gives up, not on the first failed charge

Every credit/feature check reads the local row, never Stripe's API live. A
user with no row is implicitly free — nothing to backfill at signup.

### Preventing free-tier abuse

Two different threats, two different fixes:

**Webhook forgery** — a forged POST to `api/stripe-webhook.ts` claiming
`checkout.session.completed` would grant full Studio access with no real
charge. Signature verification against `STRIPE_WEBHOOK_SECRET` closes it.
Build this in from the first line of the handler, not as a follow-up — it's
the single highest-severity gap possible in this plan.

**Multi-accounting** (stacking free accounts to avoid the caps) — real but
bounded. At ~$0.03–0.05/generation call, even determined manual reuse of a
few free accounts costs a few dollars, not real revenue. Proportionate
defenses: CAPTCHA on signup, Supabase's per-IP sign-up rate limit (Phase
7), blocking known disposable-email domains. The daily caps themselves
already bound worst-case exposure per account — they're doing most of the
real work, not a separate anti-fraud system. The free tier's own limits
(now: 1 project, 1 territory, no downloads, no quality bump) are the
strongest defense of all — for anyone who wants a real pitch, paying $29 is
less friction than juggling throwaway accounts.

---

## Phase 7 — Production hardening (new — not in the original spec)

The work that turns "works when I test it" into "safe to leave running."

**Dependencies:** Phase 6 shipped; the production domain already live on
Vercel; vendor dashboards for Anthropic, fal.ai, ElevenLabs, Supabase, Vercel.

**Action items**
- ✅ Storage lifecycle: `api/panel.ts` now deletes the previous panel row +
  blob for a beat once a regenerate succeeds, and a new
  `api/delete-project.ts` walks all three Storage buckets before deleting
  a project (see README). VO blobs were never unbounded to begin with —
  the path is keyed by voice id, so switching voices tops out at one blob
  per distinct voice ever used on a territory, not one per generation.
- Turn on Vercel's built-in Firewall (WAF + rate limiting, included in
  Pro) and tune its managed rules — ahead of Supabase's own auth rate
  limits, not instead of them. Standalone Cloudflare proxying isn't
  necessary here: no card data ever reaches your servers (Stripe Checkout
  is hosted), and Vercel's Firewall already covers this threat profile.
  Registering the domain at Cloudflare for its at-cost pricing is still
  fine — just skip turning on its proxy/WAF.
- Error tracking (Sentry or equivalent) on both the client and `/api/*`
- Per-vendor spend alerts (Anthropic, fal.ai, ElevenLabs) before paid
  signups open, so a bug can't produce a surprise bill — see below for
  what each vendor actually offers, checked live August 2026
- Terms of Service + Privacy Policy, naming the LLC as the contracting
  party (see Operations — write these after the entity exists)
- Confirm Supabase's 7-day Pro backups are actually restorable, not just enabled

**Checkpoint** — deleting a project actually frees its Storage; a
simulated vendor cost spike pages you before it drains the month's margin.

### Per-vendor spend alerts — what each vendor actually offers

Checked live against each vendor's own docs, not assumed from memory —
worth re-checking at setup time in case something's shipped since.

- **Anthropic Console** (console.anthropic.com) — supports both a
  workspace-level spend limit and a per-API-key spend limit, plus
  configurable spend-threshold alert emails. Set both: the workspace
  limit as the hard backstop, a per-key limit on Territory's production
  key specifically so a leaked key or a runaway loop can't spend past it.
- **fal.ai** (fal.ai/dashboard/billing) — the dashboard shows real-time
  spend, invoices, and usage line items, but nothing in fal's own docs
  confirms a built-in spend-limit-alert feature as of this check. Until
  that changes, treat this vendor's real backstop as already built: the
  app's own per-user daily image-call cap already bounds worst-case
  exposure (a bug can burn at most `image_calls_limit × active users ×
  ~$0.03`/day, not an unbounded amount) — check the billing dashboard
  manually on a recurring basis (weekly is reasonable pre-launch) rather
  than relying on a vendor alert that may not exist yet.
- **ElevenLabs** — Workspace settings → Groups → Manage Usage Limit: create
  one billing group covering the account and set a credit-usage quota.
  This is a hard cap that resets each billing cycle, not just an alert —
  stronger than what Anthropic or fal.ai offer, so worth setting even
  though it means generation stops rather than just paging you.

---

## Marketing site — separate from the app (moved up, building alongside Phase 7)

The original spec reserved `/` inside the app itself for a landing page
(it isn't auth-gated, so nothing technical stopped that). Superseded by
your call to keep it genuinely separate: a distinct, lightweight static
site, its own small folder, deployed as its own Vercel project — not a
route inside the app's React codebase. Kept deliberately simple (plain
HTML/CSS, no framework, no build step) since it's a handful of pages
whose job is persuasion and a clear path to signup, not application logic.

**Dependencies**
- The production domain (Phase 6/7's outstanding item) — standard split
  once it exists: marketing site on the root domain, app on an `app.`
  subdomain (e.g. `territory.co` → marketing, `app.territory.co` → the
  tool). Buying the domain is the one piece of this that's still blocked
  on nothing but timing, and both this and the app deploy need it decided
  before either goes live on a real domain — usable on Vercel's free
  `*.vercel.app` subdomains for building and review in the meantime.
- A second, separate Vercel project (same account, same team, different
  repo or a different root directory of the same repo — no new billing
  relationship needed on Vercel's free Hobby tier for a static site)

**Action items**
- Home, Features, and Pricing pages — real copy against Territory's
  actual mechanics (3 territories, locked look, timed board, exportable
  animatic) and the $29/mo Studio price already set in Phase 6, not
  placeholder text
- Every path to conversion points at the app's `/login` (magic link
  signup lives there already — no separate signup flow to build)
- Simple page-view counter — the one analytics feature spec §9 allows
- A gallery of example outputs (this is the natural home for it — not an
  in-app asset library inside the tool itself, that distinction still
  matters per spec §9)
- Reuse the app's actual type/color tokens for brand consistency even
  though the implementation is plain CSS, not a shared component library

**Checkpoint** — the marketing site is live on its own Vercel deployment,
every CTA lands a visitor on the app's login page, and it renders
correctly with no build step or JS framework in the loop.

---

## Phase 8 — Growth (new — deliberately light)

Demand generation, not new product surface. Still permanently out of scope
per spec §9 regardless of revenue: team seats, comments/approval flows,
video generation, template libraries, in-app asset organization or search.

- Sequenced go-to-market: Product Hunt launch first (low-cost, high-leverage
  for this audience) → content off the example-output gallery (already free
  to produce) → paid search/social ads last, only once the landing page
  actually converts — spending on traffic before the funnel works just
  proves the funnel doesn't work, at a cost → direct outreach to small
  agencies/freelance creatives, a realistic founder-led motion at this scale

---

## Market — pricing checked against the live competitive landscape

| Product | Entry paid price | What it buys | Overlap with Territory |
|---|---|---|---|
| Boords | $50–75/mo | Storyboard + animatic tool; free: 5 boards, 10 AI images | Board/animatic mechanics — not territory generation |
| Katalist AI | $19–29/mo | AI storytelling w/ locked character consistency; ad-creative generator in early access | Closest philosophical match, closing the gap fast |
| AdCreative.ai | $29–399/mo | High-volume ad creative variants for performance marketers | Different buyer, but anchors the $29 entry point |
| **Territory** | **$29/mo** | 3 distinct campaign territories, locked look, timed board, exportable animatic | — |

**Verdict:** $29/mo holds — it matches Katalist's annual entry and
AdCreative's starter tier without reaching into Boords' agency-software
pricing.

### Unit economics — one full project run

| Call | Unit cost | Qty | Run cost |
|---|---|---|---|
| Territory generation (Claude Sonnet) | ~$0.02/call | 1 | $0.02 |
| Beat sheet generation (Claude Sonnet) | ~$0.05/call | 1 | $0.05 |
| Panel image (fal.ai FLUX, standard) | ~$0.03/image | 14 | $0.42 |
| Voiceover (ElevenLabs) | ~$0.10–0.20/1K chars | ~500 chars | $0.08 |
| **Total** | | | **≈ $0.57** |

Against the spec's own $3/run ceiling (§8) — ~5x headroom before
regeneration overhead. A realistic active Studio subscriber (~3
projects/month, with regen/voice-switching overhead) lands around
$2–3/month in vendor cost against $29/month revenue: gross margin north of
90% before hosting overhead.

**Don't add a second tier yet.** A higher "Pro" tier (more credits,
uncapped quality model) is a legitimate later lever, but can't be built
around team seats without violating spec §9's permanent exclusion on
collaboration. Launch with the two tiers already spec'd; revisit once
there's real usage data.

---

## Infrastructure — hosting, security, scaling

| Layer | Cost | What it unlocks |
|---|---|---|
| Domain registration | ~$10–13/yr | A real `.com` — needed before Phase 6 goes live |
| Vercel Pro | $20/seat/mo | 1TB bandwidth, 1M function invocations, cold-start prevention, custom domain + built-in WAF |
| Supabase Pro | $25/mo | 100K MAU, 8GB DB, 100GB Storage, 250GB egress, 7-day backups |
| **Combined baseline** | **~$46/mo** | Past the point where vendor API spend, not infrastructure, is the real cost driver |

Custom domains work on Vercel's free Hobby tier too — Pro is worth it for
the bandwidth/function limits already in this plan, and because Hobby's
terms are scoped to non-commercial use, which stops applying the moment
Phase 6 starts charging money.

**One genuine architectural advantage:** MP4 rendering runs in the browser
via ffmpeg.wasm, never on the server — render load scales with users'
machines, not yours.

**The wall you'll actually hit is Storage, not compute** — see Phase 7's
storage-lifecycle item above.

### Security checklist

| Control | Status |
|---|---|
| Row-Level Security on every table | Done |
| Vendor keys server-side only | Done |
| Per-user daily credit caps | Done |
| Free-tier feature gates (territory count, exports, quality) | Done (pre-billing placeholder — see top of this doc) |
| Vercel Firewall (WAF) managed rules + rate limiting tuned | Phase 7 |
| Supabase Auth rate limits reviewed & tuned | Phase 7 |
| Storage lifecycle (delete on regenerate/project delete) | Phase 7 |
| Vendor spend alerts | Phase 7 |
| Stripe webhook signature verification | Phase 6 (build in from line one) |

---

## Identity — on switching to usernames and passwords

**Direct answer: don't.** Checked against current (2026) authentication
guidance: passkeys are the 2026 default for new products, magic links
remain genuinely sound ("not weaker than passwords in practice") for
moderate-frequency B2C use — which is Territory's actual pattern —
and passwords are the one option actively trending toward obsolete.
Password auth reopens attack surface Territory doesn't currently have
(credential reuse, brute force, reset-flow correctness) for a UX problem
(login speed) that passkeys solve more directly.

**Recommendation:** keep magic link as the default, add passkeys (WebAuthn
— Supabase supports it) as a fast repeat-login option. Only add
email+password as a secondary, opt-in method if there's a concrete reason
(e.g. a future enterprise buyer expecting it) — never as a replacement,
and not before Vercel's Firewall and Supabase's own auth rate limits are
configured.

---

## Operations — making it a real business

General, well-established practice, not legal or tax advice for your
specific situation. The one genuinely worthwhile expense here is an hour
each with a business attorney and a CPA before Phase 6 launch.

### When to form the LLC

**Right before Phase 6 launch** — not during development. There's no
meaningful liability to shield while you're the only user; the entity
needs to exist before the first dollar of real customer money touches
Stripe, not after.

Sequence, with enough lead time that the bank account is ready before the
Phase 6 checkpoint:

1. **Form the LLC** in your home state — cheapest/simplest for a solo
   bootstrapped SaaS with no outside investors. Delaware C-corp only earns
   its cost if you plan to raise outside capital later; LLC → C-corp
   conversion when that day comes is a well-worn path, not a dead end.
2. **Get an EIN** from the IRS — free, near-instant online once the LLC is filed.
3. **Open a business bank account** under the LLC. Route every Stripe payout
   here and nowhere else.
4. **Create the Stripe account under the LLC's legal name and EIN**, not
   your personal name.

**The one mistake that voids the whole point:** commingling personal and
business funds. Keep the accounts strictly separate from the first transaction.

### Tax liability

- Single-member LLC is pass-through by default — reports on your personal
  return, no separate corporate filing at this scale.
- Quarterly estimated tax payments are an actual IRS requirement once
  revenue starts, not optional.
- S-corp election can reduce self-employment tax but adds payroll
  complexity — evaluate with a CPA once there's a real trailing-twelve-months
  number, not preemptively at $0 revenue.
- Many US states tax SaaS subscriptions now, thresholds vary by state —
  turn on Stripe Tax (or TaxJar/Quaderno) as part of Phase 6's Stripe
  setup so it's automatic from the first sale.

### Copyright and trademark — two different protections, not one

These cover different things and work differently. General practice, not
legal advice — the one place in this whole document worth an actual hour
with an IP attorney is the trademark clearance search below, not the
copyright filing.

**Copyright — protects the code and content itself.** The source code,
UI copy, and marketing-site content are automatically copyrighted the
moment they're written and saved — no registration required for the
protection to exist. What registration with the U.S. Copyright Office
(copyright.gov, ~$65, filed online via their eCO system, no attorney
required) actually buys: the right to sue in federal court at all, plus
eligibility for statutory damages ($750–$150,000 per work, court's
discretion) and attorney's fees instead of having to prove actual
financial harm. Without registration you're limited to proving your own
losses, which is a much weaker position. Practical approach: register the
source code (submitted as a literary work; portions can be redacted as
trade secret) and the marketing site's copy/design as a snapshot around
the Phase 6 launch — not after every commit. A major rewrite later is
worth a fresh registration; day-to-day feature work isn't.

**Trademark — protects the name "Territory" and any logo**, separately
from the code underneath it. Also has automatic "common law" protection
just from using it in commerce, but that's regional and weak; registering
with the USPTO gives nationwide priority and the right to use ®. Two
things make this the item worth paying an attorney for specifically:
"Territory" is a common English word, so a real clearance search matters
before filing — USPTO fees are non-refundable even on rejection, and an
existing mark in software/marketing-services classes would force a
rename after the brand is already public. Skipping the search to save the
attorney's fee risks losing far more than it saves.

**Timing — register both after the LLC exists, not before.** Same logic
as the Stripe account: registering IP under your personal name now just
means paperwork later to formally assign it to the LLC. File the
trademark application and the copyright registration in the same stretch
as forming the entity and opening the Stripe account, with the LLC as the
registered owner from the start.

### Company email, social, advertising

- **Email:** Google Workspace (or equivalent) on the production domain,
  set up alongside Phase 6's domain purchase.
- **Social — two platforms, not five:** LinkedIn (where the actual buyer —
  agency/marketing decision-makers — lives) and Instagram (the product's
  output is inherently visual/shareable, so posting real generated work
  *is* the content strategy). X/TikTok/YouTube are reasonable later
  additions, not day-one requirements.
- **Advertising:** see Phase 8's sequencing above — Product Hunt, then
  content, then paid ads only once the funnel converts, then direct
  agency/freelancer outreach.

### Other things easy to forget

- Business insurance (general liability + E&O/cyber liability) — worth
  pricing before real customers arrive, given payment processing and
  user-uploaded images.
- Bookkeeping (Wave free, or QuickBooks once volume justifies it) —
  separate revenue/expense tracking from day one.
- A monitored `support@` address — table stakes for a paid product, even solo.
- Phase 7's ToS/Privacy Policy should name the LLC, not you personally —
  write them after the entity exists.

---

## Your action items — outstanding

Everything below is built and waiting on you, not on more engineering.
Only the Stripe-account items are a *genuine* dependency on the LLC/EIN
existing — the rest were grouped here for convenience (one sitting,
once), not because they're legally blocked. Nothing here expires or
needs to be redone by waiting.

**Done**
- ✅ Ran `supabase/migrations/0011_subscriptions.sql` in the Supabase SQL
  Editor. No dependency on the LLC — the table just sits empty until the
  webhook writes rows to it, so doing this early is harmless and saves a
  step later.

**Genuinely blocked on: LLC processed + EIN issued** (Stripe accounts
under a business name need the EIN; opening it personally now just means
redoing it later, so it's worth the wait)
- ⬜ Create the Stripe account under the LLC's legal name/EIN; create the
  Studio product + $29/mo price in test mode first, live mode before
  launch
- ⬜ Copy the test secret key into `STRIPE_SECRET_KEY`, the price id into
  `STRIPE_PRICE_ID_STUDIO`
- ⬜ Install the Stripe CLI, run `stripe listen --forward-to
  localhost:5173/api/stripe-webhook`, copy the printed `whsec_...` into
  `STRIPE_WEBHOOK_SECRET`
- ⬜ Set `APP_URL` in `.env.local` (`http://localhost:5173` for local
  testing)
- ⬜ File the copyright registration (source code + marketing site
  content) and the trademark application for "Territory" — both under the
  LLC as owner; get the attorney's help on the trademark clearance search
  specifically (see Operations → Copyright and trademark above)

**Not legally blocked, just bundled with Phase 6 launch** — fine to do
earlier if you want to get ahead of it
- ⬜ Buy the production domain, point it at Vercel, set the production
  `APP_URL`/Supabase redirect URL, and create a second (production) Stripe
  webhook endpoint with its own signing secret before taking real charges

Once the LLC and EIN are in place, the Phase 6 checkpoint in the README
("Phase 6 checkpoint") is the script to run through end-to-end.
