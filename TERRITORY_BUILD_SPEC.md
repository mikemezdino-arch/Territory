# TERRITORY — Build Specification for Claude Code

You are building **Territory**, a micro-SaaS web app for advertising creatives.
One sentence: *paste a brief, get three genuinely distinct campaign directions
("territories"), lock a reusable visual "look profile," generate a consistent
set of storyboard panels, and export a timed board-o-matic (rough animatic) for
client pitches.*

The differentiator is NOT image quality. It is (1) the territory-generation
step that forces deliberately different creative directions from one brief, and
(2) the look profile — a locked, reusable style/cast/palette object injected
into every image generation call so panels stay visually consistent by
construction. Never market or build toward "perfect character consistency";
build toward "distinct, coherent directions, fast."

Owner context: solo founder, ~5 hrs/week, $300 total budget. Bias every
decision toward free tiers, minimal moving parts, and shipping over polish.

---

## 1. Stack (fixed — do not substitute)

- **Frontend:** React 18 + Vite + TypeScript. Plain CSS or Tailwind (builder's
  choice, keep it light). Deployed on Vercel.
- **Serverless:** Vercel serverless functions (`/api/*`), TypeScript. ALL
  third-party API keys live here as environment variables. The browser NEVER
  holds a vendor key.
- **Auth + DB + Storage:** Supabase (free tier). Postgres with Row Level
  Security ON for every table. Magic-link email auth. Supabase Storage buckets
  for reference images, generated panels, and exports.
- **LLM:** Anthropic API (`claude-sonnet-4-6` or newest Sonnet-class model at
  build time) for territories, beat sheets, and VO scripts. All calls request
  JSON output and are parsed defensively (strip code fences before JSON.parse).
- **Image generation:** fal.ai. Default model: FLUX-family endpoint with
  image-reference support; also wire Nano Banana Pro edit endpoint
  (`fal-ai/nano-banana-pro/edit`) as a selectable "quality" option. Reference
  images + fixed seed per look profile are the consistency mechanism.
- **TTS:** ElevenLabs API for scratch VO. One default voice; no voice picker in
  MVP.
- **Payments:** Stripe Checkout + customer portal. One subscription product,
  two prices: $29/mo ("Studio") and free tier (1 project, watermarked exports).
- **Exports:** client-side only. MP4 via ffmpeg.wasm; PDF via jsPDF. No server
  rendering.

Environment variables (set in Vercel, mirrored in `.env.local.example`):
```
ANTHROPIC_API_KEY=
FAL_API_KEY=
ELEVENLABS_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_STUDIO=
SUPABASE_URL=
SUPABASE_ANON_KEY=          # safe for browser
SUPABASE_SERVICE_ROLE_KEY=  # serverless only, NEVER shipped to browser
APP_URL=
```

---

## 2. Non-negotiable guardrails (build these FIRST, before any generation endpoint is public)

1. **Per-user daily credit cap.** Table `usage_counters(user_id, date,
   llm_calls, image_calls, tts_calls)`. Every `/api/*` generation function
   increments atomically and REFUSES with HTTP 429 + friendly message when the
   user exceeds: free tier = 40 image calls/day, 30 LLM calls/day, 5 TTS/day;
   paid = 200/100/20. Hard-code a global kill switch env var
   `GENERATION_ENABLED=true|false` checked on every call.
2. **No key leakage.** Vendor keys only in serverless. Supabase service-role
   key only in serverless. Browser uses anon key + RLS.
3. **RLS on every table:** users can only select/insert/update rows where
   `user_id = auth.uid()` (directly or via parent project).
4. **Input limits:** brief text ≤ 4,000 chars; any single prompt field ≤ 1,500
   chars; uploaded reference images ≤ 5 MB, jpg/png/webp only, max 4 per look
   profile.
5. **Idempotent panel generation:** a `panels` row is created in `pending`
   status before calling fal.ai; on failure it is marked `failed` and the
   credit is still counted. No unbounded retry loops — max 1 automatic retry.

---

## 3. Database schema (Supabase migration)

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  brief jsonb not null,          -- structured brief (see section 4)
  format text not null default ':30',  -- ':15' | ':30' | ':60'
  status text not null default 'draft',
  created_at timestamptz default now()
);

create table territories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects on delete cascade not null,
  name text not null,
  concept_statement text not null,
  tonal_words text[] not null,
  narrative_structure text not null,
  rationale text not null,
  riskiness int not null check (riskiness between 1 and 5),
  selected boolean default false,
  created_at timestamptz default now()
);

create table look_profiles (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid references territories on delete cascade not null,
  style_description text not null,     -- e.g. "night-neon graphic novel, heavy ink shadows"
  palette text not null,               -- e.g. "amber and teal, no pure white"
  lighting_rules text,                 -- e.g. "continuous warm-to-dusk gradient, no spikes"
  camera_grammar text,                 -- e.g. "single tracking camera, eye level"
  cast_json jsonb default '[]',        -- [{name, description, ref_image_url}]
  product_ref_url text,
  locked_seed bigint,                  -- set on first successful panel; reused after
  created_at timestamptz default now()
);

create table beats (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid references territories on delete cascade not null,
  ord int not null,
  duration_seconds numeric not null,
  action text not null,                -- what happens on screen
  vo_text text,                        -- scratch VO line for this beat
  shot_prompt text not null            -- full image prompt AFTER look-profile injection
);

create table panels (
  id uuid primary key default gen_random_uuid(),
  beat_id uuid references beats on delete cascade not null,
  image_url text,
  seed bigint,
  model text,
  status text not null default 'pending', -- pending | done | failed
  created_at timestamptz default now()
);

create table usage_counters (
  user_id uuid references auth.users not null,
  date date not null,
  llm_calls int default 0,
  image_calls int default 0,
  tts_calls int default 0,
  primary key (user_id, date)
);

create table subscriptions (
  user_id uuid primary key references auth.users,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free',   -- free | studio
  current_period_end timestamptz
);
```
Enable RLS on all tables with owner-only policies (join through
project → user_id for child tables).

---

## 4. Structured brief format

The New Project form collects and stores this JSON in `projects.brief`:
```json
{
  "client": "Embr",
  "product": "sleep-friendly calm energy drink, L-theanine + 40mg caffeine",
  "objective": "establish 'energy that doesn't wreck you'; drive trial",
  "audience": "24-34, urban hybrid workers, 3pm-coffee regretters, skeptical of energy-drink bro culture",
  "key_message": "Energy shouldn't cost you tonight.",
  "reasons_to_believe": ["L-theanine smooths the caffeine curve", "40mg caffeine vs 160+", "no sugar crash"],
  "tone_sliders": {"calm_vs_loud": 0.8, "wry_vs_earnest": 0.65, "premium_vs_mass": 0.75},
  "mandatories": ["can appears in final 5s", "tagline: Burn steady", "no gym or extreme-sports imagery"],
  "past_rejections": ["meditation-parody route killed as too jokey"]
}
```
Every field maps to a labeled form input. Tone sliders are 0-1 range inputs.
Mandatories and past_rejections are add-a-row text lists.

**Seed data:** ship this exact Embr brief as the demo project every new user
sees, pre-populated with the three territories in section 5's example output,
so the app demos itself with zero API spend.

---

## 5. The prompts (THE PRODUCT — implement verbatim, then iterate)

### 5a. `/api/territory` system prompt
```
You are a senior creative director running a pitch war-room. Given a brief,
produce 3 deliberately DIFFERENT campaign territories for a client pitch.

Rules:
1. Each territory must answer the brief differently — different emotional
   register, different narrative structure, different visual world. If two
   territories could share a director's reel, you failed. Discard and rethink.
2. No slogans as concepts. A concept is a WORLD and a POV, stated in 2-3
   sentences that a director could shoot from.
3. Kill any territory that reads as generic AI output — mood-boardy language,
   no specific human observation. Every concept must contain at least one
   concrete, filmable human moment.
4. Respect mandatories absolutely. Respect past_rejections: do not resubmit a
   killed direction in disguise, but you may learn from WHY it was killed.
5. Exactly one territory must be "safe" client-friendly (riskiness <= 2).
   Exactly one must be a "big swing" (riskiness >= 4).
6. Respond with ONLY a JSON array of 3 objects, no markdown fences, schema:
   { "name": str, "concept_statement": str, "tonal_words": [str,str,str],
     "narrative_structure": str, "why_this_answers_the_brief": str,
     "riskiness": int }
```
User message = the structured brief JSON, pretty-printed.
Validated example output (from the Embr test): "The 11pm test" (reverse-
chronology evening-after, riskiness 2), "Adrenaline retires" (fond farewell
to the old idea of energy, riskiness 3), "Circadian" (one-take light-gradient
metaphor, riskiness 4). Use these as the demo project's territories.

### 5b. `/api/beats` system prompt
```
You are a director's assistant breaking a chosen campaign territory into a
timed storyboard for a {format} spot.

Input: the brief, the chosen territory, and the look profile.

Rules:
1. Produce {n} beats where {n} = 8 for :15, 14 for :30, 20 for :60.
   Durations must sum to the spot length. Vary beat length for rhythm.
2. Honor mandatories (e.g. product in final 5s) with explicit beats.
3. vo_text across all beats must read as one continuous scratch VO script in
   the territory's tone. Some beats may have empty vo_text.
4. For each beat, write shot_prompt: a single image-generation prompt that
   BEGINS with the look profile block verbatim, then describes this beat's
   framing, subject, and action in concrete visual language. Never contradict
   the look profile. Reference cast members by their profile descriptions,
   not names.
5. Respond with ONLY a JSON array, schema:
   { "ord": int, "duration_seconds": number, "action": str,
     "vo_text": str, "shot_prompt": str }
```

Look profile block injected into every shot_prompt, template:
```
STYLE: {style_description}. PALETTE: {palette}. LIGHTING: {lighting_rules}.
CAMERA: {camera_grammar}. Storyboard panel, 16:9, cinematic composition,
no text or captions in image. ---
```

### 5c. `/api/panel` behavior (not a prompt — orchestration)
1. Load beat + look profile. Check credit cap.
2. Build fal.ai request: prompt = shot_prompt; image references = cast ref
   images + product_ref_url (if present); seed = look_profile.locked_seed if
   set, else random.
3. On first success for a profile, write the seed back to locked_seed.
4. Upload result to Supabase Storage `panels/` bucket; save public URL on the
   panel row; mark done.
5. "Regenerate" = same flow, keep locked_seed, allow a user-supplied
   modifier string appended to the prompt (≤200 chars).

### 5d. `/api/vo` behavior
Concatenate vo_text in beat order → single ElevenLabs TTS call → upload mp3 to
Storage → return URL. One call per territory export, credit-capped.

---

## 6. Routes / screens (React Router)

| Route | Screen | Notes |
|---|---|---|
| `/` | Landing | one-pager: value prop, 3-step visual, waitlist→signup CTA |
| `/login` | Magic link auth | Supabase |
| `/app` | Projects list | cards; "New project" button; demo project pinned |
| `/app/new` | Brief form | structured form per section 4; submit → creates project, calls /api/territory, routes to territories |
| `/app/p/:id/territories` | Territory cards | 3 cards with name, concept, tonal words, riskiness badge (1-5), rationale in expandable; "Choose this direction" per card; "Regenerate all" (credit-capped, max 2 regens/project) |
| `/app/p/:id/look` | Look profile editor | text fields per schema + up to 4 ref image uploads + product ref; "Generate beat sheet" |
| `/app/p/:id/beats` | Beat sheet review | editable table: ord, duration, action, VO; durations must sum to format length (live validation); "Generate panels" |
| `/app/p/:id/board` | Board view | MAIN SCREEN: territory rail on left (all 3, chosen one highlighted), look profile summary bar, panel grid with per-panel regenerate + status, timeline strip at bottom with play (slideshow with per-beat durations + VO audio), export buttons |
| `/app/p/:id/export` | Export | "Render MP4" (ffmpeg.wasm: stills held for durations + VO track; watermark corner logo on free tier), "Pitch PDF" (jsPDF: cover with territory name + concept, then panel grid pages with action/VO captions) |
| `/app/account` | Billing | plan, usage today, Stripe portal link |

Board view play behavior: simple in-browser slideshow (image swap on timer +
`<audio>` element). MP4 render is a separate explicit action.

---

## 7. Build order (each phase independently demoable — STOP at each checkpoint)

**Phase 1 — Territory engine.** Vite app, brief form (no auth, no DB),
`/api/territory`, territory cards. Hard-code demo brief as placeholder values.
Checkpoint: paste brief → 3 distinct territories render.

**Phase 2 — Auth + persistence.** Supabase auth, projects/territories tables,
RLS, projects list, save/load. Seed demo project.
Checkpoint: sign in, create project, revisit it.

**Phase 3 — Look profile + beats.** Profile editor with image upload to
Storage; `/api/beats`; beat sheet screen with duration validation.
Checkpoint: chosen territory → editable timed beat sheet.

**Phase 4 — Panels.** Credit-cap table + middleware FIRST, then `/api/panel`,
board view grid, per-panel regenerate.
Checkpoint: full board of panels sharing the look profile; regenerating one
panel doesn't change the others' look.

**Phase 5 — Animatic + exports.** `/api/vo`, board playback, ffmpeg.wasm MP4,
jsPDF pitch deck, free-tier watermark.
Checkpoint: downloadable :30 MP4 with VO and a PDF.

**Phase 6 — Billing.** Stripe Checkout, webhook → subscriptions table, plan
gates (1 project + watermark on free), account screen.
Checkpoint: test-mode upgrade unlocks limits.

---

## 8. Quality bar / definition of done

- Territory outputs pass the "director's reel test" on 3 varied test briefs
  (the Embr brief + two you invent: a B2B SaaS brief and a nonprofit brief).
- A full :30 project runs brief→MP4 in under 10 minutes of user time.
- Total API cost per full run ≤ $3 (log per-call costs to console in dev).
- Lighthouse performance ≥ 80 on board view.
- Every generation failure shows a human-readable retry message; nothing
  silently spins.
- `README.md` with setup steps; `.env.local.example`; Supabase migration file
  in `/supabase/migrations`.

## 9. Explicitly OUT of scope for MVP (do not build even if easy)

Team collaboration, comments/review/approval flows, video generation,
voice selection, custom model fine-tuning, template libraries, asset
organization/tagging/search of any kind, admin dashboard, analytics beyond a
simple page-view counter. If a feature resembles review/approval or
file/asset management, it is out of scope permanently, not just for MVP.
