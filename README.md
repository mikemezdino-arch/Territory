# Territory

Micro-SaaS for advertising creatives: paste a brief, get three genuinely
distinct campaign territories, lock a look profile, generate a consistent
storyboard, export a rough animatic.

This build is currently at **Phase 6 — Billing** (see
[`TERRITORY_BUILD_SPEC.md`](./TERRITORY_BUILD_SPEC.md) for the full plan;
[`ROLLOUT_PLAN.md`](./ROLLOUT_PLAN.md) covers Phase 6 in detail and
beyond — tier breakdown, subscription tracking, abuse prevention,
market-checked pricing, hosting/security, and business formation). Stripe
Checkout + webhook + billing portal are built; what's left is Stripe
account setup itself (see Phase 6 setup below) — the code has no fake or
placeholder behavior left, it just needs real Stripe test keys to run
against.
Magic-link auth, persisted projects/territories, look profiles + beat sheets,
AI-generated storyboard panels with a shared locked seed, and now scratch VO,
in-browser animatic playback, and MP4/PDF export.

Also includes several features beyond the spec, added after the base 5
phases:
- A "have your own direction?" box on the territories screen that analyzes a
  user-pasted custom territory against the brief instead of only offering
  the 3 AI-generated ones.
- Multiple territories can be developed in parallel per project — choosing a
  direction no longer deselects others. Routes for look/beats/board/export
  are keyed by territory id (`/app/p/:id/t/:territoryId/...`), each with its
  own look profile, beat sheet, and panels.
- A persistent left sidebar (Projects / Beat sheets / Animatics / Pitches)
  links to the current territory's Beats/Board/Export pages. It's derived
  strictly from the current URL (`useMatch` on
  `/app/p/:id/t/:territoryId/*` in `src/components/Sidebar.tsx`), not from
  any persisted "last visited" state — it locks the instant you navigate
  away from a territory's pages (e.g. back to the Projects list), rather
  than staying unlocked from memory. This is deliberately project-scoped
  navigation, not a cross-project asset browser — the spec permanently
  rules out asset-management-style features.
- Projects can be deleted from the Projects list (with a confirmation
  prompt), which now calls `api/delete-project.ts` instead of deleting the
  row directly. DB rows still cascade via FK `on delete cascade`; Storage
  files don't get that for free (Postgres cascade doesn't touch Storage),
  so the endpoint walks each territory's `${user_id}/${territory_id}/`
  prefix across the `panels`, `audio`, and `references` buckets and
  removes them before deleting the project row. Runs under the
  service-role key, so it isn't blocked by the RLS delete gotcha noted
  above.
- Regenerating a panel (`api/panel.ts`) inserts a fresh `panels` row and a
  new Storage blob per attempt rather than overwriting in place, so past
  attempts for the same beat are cleaned up right after a new one finishes
  successfully — a failed regenerate leaves the last good panel untouched,
  since cleanup only runs in the success path.
- Voice selection for VO on the Board page (curated shortlist in
  `src/lib/voices.ts`), a script-only PDF export on the Beats page, and a
  dark slate/navy theme throughout.
- A music bed picker on the Board page (curated shortlist in
  `src/lib/musicBeds.ts`, 14 royalty-free tracks in the `audio` bucket) — a
  territory's selection persists to `territories.music_bed_path` and mixes
  into both the in-browser Play preview (a second `<audio>` element at
  reduced volume, looped) and the MP4 export (ffmpeg `amix` filter, music
  under VO).
- Free-tier feature gates: one territory per project, no MP4/Pitch PDF
  export, no higher-quality image rendering, lower daily generation caps.
  Backed by a real per-user subscription lookup now — `subscriptions`
  (migration 0011), read client-side via `src/context/PlanProvider.tsx` +
  `src/hooks/usePlan.ts` (one query per app session, not per page) and
  server-side via `api/_lib/plan.ts`'s `isUserOnFreePlan()`, used by both
  the credit-cap helper and `api/panel.ts`'s quality gate.
  `src/components/UpgradeModal.tsx` is the shared paywall dialog every gate
  opens, wired to a real Stripe Checkout session. See
  [`ROLLOUT_PLAN.md`](./ROLLOUT_PLAN.md) for the full tier breakdown.
- Add/delete a beat directly from the Beat sheet and Animatic pages
  (`src/lib/beats.ts`), not just editing the LLM-generated set. Deleting
  renumbers the remaining beats so `ord` stays contiguous (the concat
  export order and every "#N" label depend on that); a manually-added beat
  gets a real `shot_prompt` from the territory's look profile block at
  creation time, since the column is not-null and `api/panel.ts` sends it
  straight to fal.ai. The Board page was renamed "Animatic" throughout the
  UI (the sidebar already called this section "Animatics" — the page
  itself just hadn't caught up); the route and component are still
  `/board`; the component and file were renamed to `AnimaticPage.tsx` for
  internal consistency, since only two files referenced the old name
  (`App.tsx`'s import and the file itself) — the route path is unaffected.
- Custom Archivo typefaces replace the system font stack entirely — five
  roles, each mapped to its own CSS custom property in `src/index.css`
  (`--font-header`, `--font-subheading`, `--font-button`, `--font-input`,
  `--font-body`) even where roles share the same actual typeface, so each
  can change independently later without accidentally dragging another one
  along — `--font-input` and `--font-body` both currently resolve to
  Archivo Medium, on purpose, after typable text was moved off Archivo
  Condensed Medium to match body copy; that condensed-medium `@font-face`
  was removed once nothing referenced it anymore. Current mapping: `h1`
  (page titles) in Archivo Condensed ExtraBold; `h2`–`h6` (sub headings),
  buttons (native `<button>`s and `<Link>`s styled via
  `.primary-btn`/`.choose-btn`), and the sidebar nav (`.sidebar-link`) in
  Archivo Bold; every `input`/`textarea`/`select` (typable text) and
  everything else — paragraphs, labels, any text not claimed by a more
  specific rule — in Archivo Medium, the latter set once on `:root` as the
  document's base `font:` shorthand rather than the old `system-ui` stack,
  so it's the fallback every other role's `var(--sans)` chain still
  resolves to if a custom face ever fails to load. Declared as
  `@font-face` in `src/index.css`; the `.ttf` files live in
  `public/fonts/` so Vite serves them as static assets at a stable
  `/fonts/...` path, same pattern as `public/favicon.svg`.

  Getting the input/textarea/select rule to actually apply took a second
  pass: several form-control rules in `App.css` used the `font: inherit;`
  shorthand to escape browser default form-control fonts, which also resets
  `font-family` — and being more specific (e.g. `.beats-table
  input[type="number"]`) than the new bare-element rule, they won the
  cascade regardless of source order. Fixed by narrowing every such rule to
  `font-size: inherit;`, which keeps the original sizing intent without
  fighting the global font-family rule.

  Headings, buttons, and back-navigation links (`.back-link` — the "←
  Beat Sheet" style header link on every page, and the plain "Back to
  territories" fallback shown when a page fails to load) all get
  `text-transform: capitalize`. It's a CSS transform, not a text-content
  edit, which matters because several headings render dynamic, user-typed
  content (project titles, territory names) — capitalizing the stored
  string itself isn't an option, and CSS handles static and dynamic text
  identically for free. The fallback "Back to X" links had no shared class
  at all before this — they were plain unstyled `<Link>`s — so they
  picked up `.back-link`'s styling (muted color, hover underline) as a
  side effect of giving them something to hook the transform onto, not
  just the capitalization itself.

## Stack

React 18 + Vite + TypeScript on the frontend, React Router for `/login`,
`/app`, `/app/new`, `/app/p/:id/territories`, `/app/p/:id/look`,
`/app/p/:id/beats`, `/app/p/:id/board`, `/app/p/:id/export`. Supabase for
auth (magic link), Postgres storage with row-level security, and Storage for
reference images, generated panels, and VO audio. fal.ai for image
generation, ElevenLabs for TTS, ffmpeg.wasm + jsPDF for client-side export.
Nine Vercel serverless functions — `api/territory.ts`, `api/beats.ts`,
`api/panel.ts`, `api/upload-reference.ts`, `api/territory-analyze.ts`,
`api/vo.ts`, `api/checkout.ts`, `api/stripe-webhook.ts`,
`api/billing-portal.ts` — call the vendor APIs and write results to the
database; vendor keys and the Supabase service-role key only ever live
there, never in the browser. Stripe for billing (Checkout, webhook,
customer billing portal).

## Setup

```bash
npm install
cp .env.local.example .env.local
# edit .env.local: set ANTHROPIC_API_KEY, FAL_API_KEY, ELEVENLABS_API_KEY,
# and the SUPABASE_* / VITE_SUPABASE_* vars
```

In the Supabase SQL Editor for your project, run these once, in order:
1. [`supabase/migrations/0001_projects_territories.sql`](./supabase/migrations/0001_projects_territories.sql)
2. [`supabase/migrations/0002_look_profiles_beats.sql`](./supabase/migrations/0002_look_profiles_beats.sql)
3. [`supabase/migrations/0003_storage_policies.sql`](./supabase/migrations/0003_storage_policies.sql) — not
   currently load-bearing (see note below) but harmless to apply.
4. [`supabase/migrations/0004_demo_project_uniqueness.sql`](./supabase/migrations/0004_demo_project_uniqueness.sql)
5. [`supabase/migrations/0005_usage_panels.sql`](./supabase/migrations/0005_usage_panels.sql)
6. [`supabase/migrations/0006_territory_vo_url.sql`](./supabase/migrations/0006_territory_vo_url.sql)
7. [`supabase/migrations/0007_territory_vo_voice.sql`](./supabase/migrations/0007_territory_vo_voice.sql)
8. [`supabase/migrations/0008_projects_delete_policy.sql`](./supabase/migrations/0008_projects_delete_policy.sql)
9. [`supabase/migrations/0009_territory_music_bed.sql`](./supabase/migrations/0009_territory_music_bed.sql)
10. [`supabase/migrations/0010_beats_delete_policy.sql`](./supabase/migrations/0010_beats_delete_policy.sql)
11. [`supabase/migrations/0011_subscriptions.sql`](./supabase/migrations/0011_subscriptions.sql)

Then create the Storage buckets used for reference images, generated panels,
and VO/music audio:

```bash
node scripts/create-storage-bucket.mjs references 5 image
node scripts/create-storage-bucket.mjs panels 10 image
node scripts/create-storage-bucket.mjs audio 10 audio
```

The `audio` bucket holds both per-user VO (`${userId}/${territoryId}/vo.mp3`)
and the shared music bed library (14 mp3s at the bucket root, uploaded
manually — filenames are listed in `src/lib/musicBeds.ts`). If you're setting
this up fresh, upload royalty-free tracks there yourself and update that
manifest to match; nothing auto-discovers bucket contents.

Also add `http://localhost:5173` (and your deployed `APP_URL` later) to
Supabase → Authentication → URL Configuration → Redirect URLs, or magic-link
sign-in will redirect somewhere broken.

```bash
npm run dev
```

Open the printed local URL, sign in with a magic link, and you'll land on
`/app` with a demo Embr project pre-seeded (brief + 3 territories, zero API
spend). Click **New project** to paste your own brief and generate territories
for real, choose a territory (or analyze your own custom one), fill in a look
profile, generate a beat sheet, generate panels on the board, then press
**Play** for an animatic preview or go to **Export** for an MP4/PDF.

### How `/api/*` functions run locally

There's no Vercel CLI dependency. `vite.config.ts` includes a small dev-only
middleware that loads `api/*.ts` files as Vercel-style handlers
`(req, res) => ...` directly inside the Vite dev server, using the same
handler code that runs in production on Vercel. Nothing in the `api/*.ts`
files is dev-only. Shared helpers live in `api/_lib/` (the leading
underscore keeps Vercel from routing them as endpoints).

### Environment variables

- `ANTHROPIC_API_KEY` — required. `ANTHROPIC_MODEL` optionally overrides the
  model (defaults to `claude-sonnet-4-5-20250929`). `GENERATION_ENABLED=false`
  is a global kill switch; every `/api/*` generation endpoint returns 503
  when set.
- `FAL_API_KEY` — required for panel generation. `FAL_MODEL_TEXT_TO_IMAGE`,
  `FAL_MODEL_WITH_REFERENCE`, `FAL_MODEL_QUALITY` optionally override the
  default model ids (see note below on how these were chosen).
- `ELEVENLABS_API_KEY` — required for VO generation. `ELEVENLABS_VOICE_ID`,
  `ELEVENLABS_MODEL_ID` optionally override the default voice/model (see
  note below — the obvious default voice choice doesn't actually work on
  free-tier accounts).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — required.
  The service-role key is serverless-only and must never be prefixed with
  `VITE_` or otherwise shipped to the browser.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — same URL/anon values as
  above, duplicated with the `VITE_` prefix so Vite exposes them to the
  browser bundle. The anon key is safe client-side; RLS is what actually
  restricts access to `projects`/`territories`/`look_profiles`/`beats`/
  `panels`. `usage_counters` is server-write-only (service-role key bypasses
  RLS); the client can only ever read its own rows.
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_STUDIO`, `STRIPE_WEBHOOK_SECRET`,
  `APP_URL` — required for Phase 6 billing (`/api/checkout`,
  `/api/stripe-webhook`, `/api/billing-portal`). See "Phase 6 setup —
  Stripe" below for how to get each one.

### Daily credit caps

Every `/api/*` generation endpoint (`territory`, `beats`, `panel`, `vo`,
`territory-analyze`) checks and atomically increments a per-user, per-day
counter via the `increment_usage_counter` Postgres function before doing any
expensive vendor call, and refuses with HTTP 429 once the limit is hit.
Free-tier limits are 30 LLM calls/day, 40 image calls/day, 5 TTS calls/day;
Studio subscribers get 200/100/20. `api/_lib/creditCap.ts` picks the limit
table by calling `api/_lib/plan.ts`'s `isUserOnFreePlan()`, which reads the
caller's real `subscriptions` row — every existing call site needed no
changes to become plan-aware, since the limit lookup happens inside the
shared helper, not at each call site. VO is additionally cached per
territory (`territories.vo_url`) — ElevenLabs is only ever called once per
territory, not once per export.

### Phase 6 setup — Stripe

1. Create a Stripe account (or use an existing one) and switch to **test
   mode**.
2. Create one product with a single recurring price — $29/mo, USD. Copy
   that price's id (starts with `price_`) into `STRIPE_PRICE_ID_STUDIO`.
3. Copy the test-mode secret key (Dashboard → Developers → API keys,
   starts with `sk_test_`) into `STRIPE_SECRET_KEY`.
4. Webhook signing secret, locally: install the [Stripe
   CLI](https://stripe.com/docs/stripe-cli), run `stripe login`, then
   `stripe listen --forward-to localhost:5173/api/stripe-webhook` — it
   prints a `whsec_...` secret for as long as that command keeps running;
   put it in `STRIPE_WEBHOOK_SECRET`. This is a different, temporary
   secret from the one you'd get creating a webhook endpoint in the Stripe
   Dashboard for production, which is tied to the endpoint's real deployed
   URL and doesn't expire.
5. Set `APP_URL=http://localhost:5173` locally — Checkout's success/cancel
   URLs and the billing portal's return URL are both built from it.
6. Run migration 0011, then test end-to-end with Stripe's test card
   `4242 4242 4242 4242`, any future expiry date, any CVC. Watch the
   `stripe listen` terminal — it logs every event it forwards and the
   response your endpoint returned, which is the fastest way to see
   whether the webhook actually processed something or silently no-opped.

### Signature verification needs the raw request body, not the parsed one

`api/stripe-webhook.ts` exports `config.api.bodyParser = false` — Stripe's
`constructEvent()` needs the exact raw bytes it signed, and a
JSON.parse/re-stringify round-trip isn't guaranteed byte-identical (key
order, whitespace). The local dev shim (`vercelApiDevPlugin` in
`vite.config.ts`) originally always consumed and JSON-parsed every
`/api/*` request body before calling the handler, which would have broken
this the same way real Vercel breaks it without the config export — fixed
by having the shim check the loaded module's `config.api.bodyParser`
before touching the stream, leaving it untouched for the handler to read
itself when disabled, mirroring what real Vercel does.

### Stripe's Basil API version moved `current_period_end` off the subscription

As of Stripe's 2025-03-31 Basil API version, `subscription.current_period_end`
no longer exists — the field moved to each subscription item
(`subscription.items.data[0].current_period_end`). The request still
returns 200 with a clean-looking object either way; the field is just
silently `undefined` on the old path, which would have meant every synced
`current_period_end` in `subscriptions` was quietly `null` forever.
`api/stripe-webhook.ts` reads it from the item, confirmed against the
installed `stripe` package's own TypeScript types rather than assumed from
memory.

### Reference image uploads go through the server, not direct-to-Storage

`0003_storage_policies.sql` sets up a `storage.objects` RLS policy for
direct browser-to-Storage uploads (the usual Supabase pattern), but in
testing, uploads through that path consistently failed with "new row
violates row-level security policy" despite the policy, JWT, and bucket all
checking out correctly — root cause unresolved. `api/upload-reference.ts`
sidesteps it: the browser sends the image as base64 JSON to that endpoint,
which verifies the caller owns the territory and uploads via the
service-role key (the same trust pattern used by the other endpoints).

Caveat: Vercel's serverless functions have a body-size limit (~4.5MB), and
base64 inflates payload size by ~33%, so in production this endpoint
reliably handles images up to roughly 3MB rather than the full 5MB spec
limit. Local dev has no such limit. If this becomes a real constraint, the
proper fix is a signed-upload-URL flow (server issues a short-lived signed
URL, browser uploads directly to Storage with it) rather than routing file
bytes through the function.

### fal.ai model selection is a best guess, verified live

The spec names `fal-ai/nano-banana-pro/edit` explicitly for the "quality"
option; the default FLUX-family model ids
(`fal-ai/flux/dev` for text-only, `fal-ai/flux-pro/kontext/multi` when
reference images are present) were chosen from general knowledge of fal.ai's
catalog rather than live docs, since fal.ai's model lineup changes quickly.
Both were tested against the real API during Phase 4 verification and work
correctly as of this build. If fal.ai changes these endpoints later, override
via the `FAL_MODEL_*` env vars above rather than editing code.

### ElevenLabs voice/model choices are account metadata, not guessable

Two lessons from getting the ElevenLabs setup right, both the same shape:
don't assume, query live.

The obvious default voice choice for a project like this ("Rachel",
`21m00Tcm4TlvDq8ikWAM`) is a shared "voice library" voice that returned
`402 payment_required` when called via the API on a free-tier account —
confirmed live during Phase 5. The curated shortlist in `src/lib/voices.ts`
avoids that entirely by only using premade voices confirmed available via
`GET /v1/voices` on a real account.

That same live query later caught a second issue: two voices in the
original shortlist ("George," "Daniel") turned out to be British-accented,
not American — accent and gender are labels ElevenLabs attaches per voice,
not something inferable from a name or a "warm captivating storyteller"
style description. The current six-voice shortlist was rebuilt from a live
`GET /v1/voices` call, filtered to `accent: "american"` and split evenly
3-and-3 between genders. `api/vo.ts` defaults to "Eric"
(`cjVigY5qzO86Huf0OWal`); override via `ELEVENLABS_VOICE_ID` if you'd
rather default to a different voice your account has access to.

The TTS model defaults to `eleven_v3`, ElevenLabs' flagship model as of
2026 — most natural, emotionally expressive delivery, recommended for
short-form narration. Its higher latency versus `eleven_multilingual_v2`
(the earlier default) doesn't matter here since VO is generated once and
cached per territory, never streamed live. Override via
`ELEVENLABS_MODEL_ID` if needed.

VO is stored per-voice, not per-territory: `api/vo.ts` writes to
`${userId}/${territoryId}/vo-${voiceId}.mp3` rather than a single fixed
`vo.mp3` path. An earlier version used the fixed path with `upsert: true`,
so regenerating with a different voice overwrote the same file — the bytes
changed on the server but the public URL didn't, so the browser (and
Supabase's CDN) kept serving the old voice's cached response after
switching. Confirmed live: requesting the same already-cached voice twice
correctly short-circuits to the cached URL, while requesting a genuinely
different voice now returns a distinct URL every time.

### ffmpeg.wasm core must be loaded as ESM, not UMD

`renderMp4` in `src/lib/exportUtils.ts` loads ffmpeg.wasm's single-threaded
core from CDN (no COOP/COEP headers needed, since it's not the multi-threaded
build). The core ships in both UMD and ESM builds; our worker runs as
`type: "module"` and needs the **ESM** build
(`@ffmpeg/core/dist/esm/ffmpeg-core.js`). Pointing at the UMD build instead
fails silently — `import()`-ing a UMD script resolves with no `default`
export (UMD isn't real ESM), which ffmpeg.wasm's worker reports as the
unhelpful `"failed to import ffmpeg-core.js"` rather than a parse error. Cost
real debugging time to track down; documenting it here so it doesn't get
reintroduced if this code is touched later. Confirmed working end-to-end
(valid MP4 with correct `ftyp`/`isom` container signature, watermark, and VO
audio track all present) after the fix.

### Don't use `-shortest` in the MP4 encode command

A second bug in the same command: `-shortest` tells ffmpeg to stop *encoding
all streams* the moment the shortest one ends. Beat sheets frequently have a
VO track much shorter than the full spot (many beats have empty `vo_text` by
design — see spec 5b), so `-shortest` was silently truncating the entire
video down to the audio's length rather than just the audio going quiet for
the rest of the video, as intended. Without it, ffmpeg's default behavior —
run until the longest stream ends — is correct here: the concatenated beat
images define the true runtime, and VO simply stops early when it's shorter.
Confirmed by parsing the output MP4's `moov/mvhd` box directly: video frame
count now matches the full beat-duration sum regardless of VO length.

### Music bed mixing uses `-t`, not `-shortest`, to cap output length

When a music bed is selected, `renderMp4` mixes it with VO via ffmpeg's
`amix` filter (`[music]volume=0.3[music];[vo][music]amix=inputs=2:duration=longest[aout]`)
rather than reusing `-shortest`, which caused the truncation bug documented
above. Music tracks are typically much longer than a :15/:30/:60 spot, so
relying on any input stream's natural length is wrong in either direction.
Instead the output is explicitly capped with `-t <sum of beat durations>` —
the beat sheet is the single source of truth for runtime; audio (VO, music,
or the mix) is cut or padded with silence to match, never the other way
around.

## Deploying

Deploy to Vercel as usual (`vercel`). The `api/*.ts` files are picked up
automatically as serverless functions. Set the same environment variables in
the Vercel project settings, and add the production `APP_URL` to Supabase's
redirect URL allow-list.

For Stripe specifically: the `stripe listen` webhook secret from local dev
is temporary and tied to that CLI session — it won't work in production.
Create a real webhook endpoint in the Stripe Dashboard pointed at
`https://<your-domain>/api/stripe-webhook`, subscribed to
`checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`, and `invoice.payment_failed`, then use
*that* endpoint's own signing secret for the production
`STRIPE_WEBHOOK_SECRET` — don't reuse the local one.

## Phase 5 checkpoint

From a project with a full board of panels: press **Play** on the board to
preview the animatic (image slideshow timed to each beat's duration, synced
with VO audio) → go to **Export** → **Render MP4** produces a downloadable
`:30` video with VO and a free-tier watermark, **Pitch PDF** produces a
downloadable deck (cover page + one panel page per beat with action/VO
captions).

## Phase 6 checkpoint

With Stripe test keys configured (see "Phase 6 setup — Stripe" above) and
`stripe listen` running: click **Subscribe** (or trigger any free-tier
gate) → **Upgrade — $29/mo** → complete Checkout with the test card → land
back on `/app/account?upgraded=1` showing **Territory Studio — $29/mo**
within a couple seconds of the webhook landing → a second territory,
MP4/Pitch PDF export, and higher-quality rendering are all unlocked with no
page other than `/app/account` needing a refresh, since `usePlan()` is
shared app-wide via `PlanProvider`. **Manage billing** on that same page
opens a real Stripe billing portal session; canceling there should leave
Studio access intact until `current_period_end`, not revoke it
immediately.
