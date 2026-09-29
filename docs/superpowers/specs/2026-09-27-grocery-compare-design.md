# grocery-compare — Design Spec

**Date:** 2026-09-27
**Status:** design approved section by section; this document covers Phase 1
**Research:** [platform probe](../../research/2026-09-27-platform-probe.md) ·
[fee research](../../research/2026-09-27-fee-research.md) ·
[raw captures](../../research/2026-09-27-probe-captures/)

## Problem

Indian households buy groceries across quick-commerce apps (Blinkit, Zepto, Swiggy
Instamart) and cheaper slotted services (JioMart, DMart Ready). The same item costs
different amounts on each app, and every app adds its own order-level fees: a delivery
fee below a free-delivery threshold, a small-cart fee, a handling fee, a minimum order.
Those fees are about the same size as the price differences between apps, which creates
two traps:

- Buying everything on one app leaves the per-item savings on the table.
- Buying each item wherever it is cheapest opens extra orders, each paying its own fees,
  and can leave every order just under its free-delivery threshold.

The cheapest way to buy a list is a joint decision across all items and all apps at
once. Nobody can do that in their head, and no tool does it today.

## What already exists (checked 2026-09-27)

| Product | What it does | Login |
|---|---|---|
| Smartprix (web + app) | Cart total per store including fees, plus a "lowest possible" column whose method is unstated | none |
| Comparify (web + app) | Per-item prices across 10 platforms | none |
| Quick Compare (iOS) | Per-item prices, redirects to the platform | none |
| QuickSola (iOS, beta: Delhi, Mumbai, Bengaluru) | The single cheapest platform for the whole cart | none |
| Dealulu (Android) | Links Blinkit/Swiggy/Zepto accounts; universal cart; one-tap cart transfer. Website unreachable on 2026-09-27 | linked accounts |

Two conclusions:

1. **Anonymous, per-location prices for Blinkit, Zepto and Instamart can be obtained.**
   Several products serve them without any login. It is an engineering problem, not a
   wall.
2. **None of them visibly plans a fee-aware split or offers alternatives**, e.g. which
   items to buy where, and what one fewer order would cost. That is this product.

## Phasing

- **Phase 1 (this spec).** A web app. Prices are fetched server-side without any login,
  and ordering is a hand-off to each app.
- **Phase 2 (its own spec, later).** An Android app. The user links each platform account
  on the phone, and sessions never reach our servers. The phone fetches prices itself, so
  prices and fees are exact for that user. The app also transfers carts. iOS is not
  planned: App Store guideline 5.2.2 requires permission from the third-party service.
- **The engine is shared.** Parsing, matching, pack fills, fees and the optimizer don't
  know where prices come from. In Phase 2 the phone replaces the fetch worker behind the
  same adapter contract.

## Rejected approach: holding users' platform logins on our server

The idea was for users to log in to each platform through us once, with our server keeping
the sessions and placing orders. It is rejected for three independent reasons; any one is
enough.

1. **It does not get past the blocking.** Cloudflare (Blinkit) and AWS WAF (Zepto,
   Instamart) judge the *client* before any account is looked at: its TLS fingerprint, and
   whether it runs JavaScript. The login endpoints sit behind the same edges. Every
   account would also then operate from our datacenter IPs, which is how accounts get
   flagged.
2. **It cannot pay.** Every UPI or card payment needs the user's own approval (UPI PIN,
   card OTP), so "placing the order" reduces to filling the cart. Phase 2 does that
   without holding any sessions.
3. **Custody.** Live sessions for accounts with home addresses, order history and wallet
   balances would make us one high-value target, with obligations under India's DPDP Act.
   med-compare's spec rejected stored credentials for the same reason.

## What v1 does

1. **Location.** "Use my location" (browser geolocation) or a 6-digit pincode.
   - Both are resolved to coordinates plus a pincode. Blinkit, Zepto and Instamart pick a
     dark store from coordinates; JioMart and DMart pick a store from the pincode.
   - A pincode-only location uses the pincode's centroid. The results then say
     "approximate location: use GPS for exact dark-store prices".
2. **The list.** Each row is an item name with autocomplete, a quantity, and a unit
   dropdown: `g · kg · ml · L · pcs · dozen · pack`.
   - Typing "atta 5kg" into the name fills in the quantity and unit.
   - "Paste your list" takes a WhatsApp-style list, one item per line or comma.
   - Hinglish names (*pyaz*, *dahi*, *chini*, …) are understood.
   - A named brand locks the row to that brand. Any row can be switched to "any brand".
3. **Memberships.** Optional toggles, one for each programme whose fee effect the catalog
   has a source for. They lower thresholds or waive fees exactly as each programme does.
   At launch that is Zepto Club (free delivery from ₹99). Swiggy One gets a toggle once
   its Instamart effect is confirmed; today's sources conflict.
4. **Compare.** Per-app progress is shown as results arrive. The plan updates live as each
   app answers, and is marked final once every app has answered or timed out.
5. **Results.** Two tabs, *Plan* (order cards) and *All prices* (a grid). See "Results
   screen".
6. **Order.** Each order gets a hand-off checklist of product links, which open the
   platform's app on a phone. The user ticks items off as they add them.

The list, location, memberships, fee overrides, pins and excluded apps are kept in
`localStorage` behind try/catch. There are no accounts.

**Out of scope for v1:**
- Accounts.
- Cart transfer and per-user fees (Phase 2).
- Coupon codes and bank offers. They can't be verified without a login, and a stale code
  is worse than none.
- Cashback programmes. Coins are not cash.
- Price history and alerts.
- "Add to an existing order" windows (Blinkit lets you add items while an order is being
  packed, with no new fees). This is a Phase 2 idea.
- Amazon and Flipkart.

## Platforms

Evidence comes from plain HTTP requests made on 2026-09-27; details are in the probe
report.

| Platform | Plain HTTP | How location is chosen | v1 transport |
|---|---|---|---|
| Blinkit | blocked: Cloudflare 403 `cf-mitigated: challenge` on every path | lat/lon cookies + headers | `impersonate` (spike S1) |
| Zepto | search blocked: AWS WAF 202 `x-amzn-waf-action: challenge` | lat/lng → storeId (`api.zepto.co.in`, answers) | `browser` (spike S2) |
| Instamart | search blocked: AWS WAF 202 | lat/lng → pods (`select-location/v2`, answers) | `browser` (spike S2) |
| JioMart | works | pincode → store uid (`delivery-promise`) → store filter in the search URL | `plain` |
| DMart Ready | works | pincode → `storeId` header | `plain` |
| BigBasket (BB Now) | works, but priced for the *caller's IP*; the pincode cookie is ignored | IP-derived; the listing API's error text says it accepts "lat-long" | `plain` if spike S3 passes, else out |
| Amazon Fresh, Flipkart grocery, Flipkart Minutes | unusable anonymously / not serviceable | — | out of v1 |

**The v1 set** is Blinkit, Zepto, Instamart, JioMart and DMart Ready, plus BigBasket if
spike S3 passes. DMart Ready operates in 11 cities and delivers in slots; where it isn't
available it reports "not serviceable here".

## Architecture

```
Browser ── list + location ──▶  apps/web  (Next.js 16 on Vercel)
                                UI · /api/compare (SSE) · /api/plan · engine
                                        │  HMAC-signed request
                                        ▼
                                apps/fetcher  (Node 22, Docker, VPS in India)
                                ├─ plain ───────── JioMart, DMart (BigBasket)
                                ├─ impersonate ─── Blinkit
                                ├─ browser ─────── Zepto, Instamart
                                └─ caches: store lookup 24 h · search 15 min
```

- **`apps/web`** holds the UI and API routes, and runs the engine on the Node runtime.
- **`apps/fetcher`** owns all traffic to platforms: store lookup, search, transports,
  caching, politeness towards each platform, and per-client rate limits. It returns raw
  listings and knows nothing about lists or plans.
  - It is split out because Vercel functions can't comfortably host headless Chrome or a
    native TLS-impersonation client, and warm browser sessions need a long-lived process.
  - It runs as a Docker image on a VPS with 2 GB+ RAM in an Indian region. Which provider
    doesn't matter to the code.
- **`packages/engine`** is pure TypeScript with no I/O: quantities, list rows, matching,
  pack fills, fees, the optimizer and explanations. The fetcher imports only its types.

Repo layout (npm workspaces, matching med-compare's npm tooling):

```
apps/web          Next.js app
apps/fetcher      platform worker
packages/engine   shared domain logic
docs/             specs, research, fee-catalog checklist
```

Carried over from med-compare:
- The adapter contract and its honest per-platform statuses.
- The streaming orchestration pattern.
- The TTL cache.
- The `/api/geo`, `/api/geo/reverse` and `/api/pincode` routes.
- The price parser.
- The affiliate link builder.
- The shadcn UI kit and visual language.

### Wire format

**Web → fetcher: `POST /v1/search`**, one request per platform.
- Body: `{ platformId, location: { lat, lng, pincode }, queries: [{ itemId, text }], clientIp }`.
- Signing: HMAC-SHA256 over `timestamp + body` with a shared secret, sent as
  `x-gc-timestamp` and `x-gc-signature`. Requests more than 60 s old are rejected.
- The response streams NDJSON:
  - `store` `{ storeId, label, eta, feeHints? }`
  - one `query` event per query `{ itemId, status, listings[] }`
  - `done` `{ status }`

**Browser → web: `POST /api/compare`** with `{ items, location, settings }`, answered with
an SSE stream:
- `meta` — the parsed rows and the apps being tried.
- `progress` — `{ platformId, done, total }`.
- `platform` — `{ platformId, status, store, perItem }` when an app finishes.
  - `perItem` maps each item to its fills, possible matches and status.
- `plan` — `{ result, final }` after each `platform` event.
- `done` — the stream is complete.

**`POST /api/plan`** takes `{ items, fills, settings }` and returns a `PlanResult`.
- It is a stateless re-solve for toggles (unlock brand, exclude app, membership, fee
  override, pin).
- Size caps: ≤ 60 rows, ≤ 8 apps, ≤ 3 fills per row per app.

## Engine

### Core types (sketch)

```ts
type PlatformId = 'blinkit' | 'zepto' | 'instamart' | 'jiomart' | 'dmart' | 'bigbasket';
type Dim = 'mass' | 'volume' | 'count' | 'pack';            // base units: g, ml, pcs, packs

interface ListRow {                                         // what the user asked for
  id: string;
  raw: string;                                              // "Aashirvaad atta"
  quantity: { value: number; dim: Dim };                    // { 5000, 'mass' }
  anyBrand: boolean;                                        // the per-row toggle
  pins: Partial<Record<PlatformId, string>>;                // listingId the user chose
}

interface Listing {                                         // one product as one app sells it
  platformId: PlatformId;
  listingId: string;
  title: string;
  brand: string | null;
  quantityText: string;                                     // as the app states it: "2 x 500 g"
  price: number;                                            // payable, INR, GST-inclusive
  mrp: number | null;
  inStock: boolean;
  productUrl: string;
  imageUrl: string | null;
  category: string | null;
  fetchedAt: string;
}

interface Fill {                                            // one way to cover a row on one app
  itemId: string;
  platformId: PlatformId;
  packs: { listingId: string; count: number }[];
  quantity: number;                                         // in the row's base unit
  cost: number;
  overBuy: boolean;                                         // exceeds the +25 % cap (see Pack fills)
  label: string;                                            // "Aashirvaad Atta 5 kg"
}
```

### Quantities

- **Base units:** mass in g, volume in ml, count in pcs, and packs. `kg` = 1000 g,
  `L` = 1000 ml, `dozen` = 12 pcs.
- **`pack`** means N packs of one listing, whatever its size. It's for things bought by
  the pack, like bread or noodles.
- **Listing quantities are parsed from each app's own quantity field.**
  - Formats: "500 g", "1 kg", "2 x 500 g" (1000 g), "Pack of 3 (100 g each)" (300 g),
    "6 pcs", "1 dozen", "1 kg (4–6 pcs)" (mass first, count second), "1 L", "200 ml".
  - An unparseable quantity means the listing can't be filled. It is counted as "size
    unknown" and never guessed.
- **Rows and listings must share a dimension.** There is one bridge: a count row against a
  mass listing that states a count range ("1 kg (6–8 pcs)") uses the range's *lower*
  bound. Every other mix, such as a mass row against a count-only listing, can't be
  filled.

### Understanding list rows

- **A built-in dictionary** of about 300 common grocery items drives autocomplete and
  parsing. Each entry has an English name, Hindi/Hinglish aliases, a default unit and a
  category hint. It is paired with about 150 brands.
- **Brand detection** finds the longest match against the brand list. A detected brand
  locks the row by default.
- **Head noun and required words.** The head noun is the product type ("milk", "rice",
  "atta"). For rows outside the dictionary, it is the last word that isn't a brand, a
  quantity or a stopword. Required words are every other word the user typed, minus
  stopwords and quantities: "full cream milk" → required `full`, `cream`;
  "sona masoori rice" → `sona`, `masoori`.
- **Search text** sent to each app is the user's words without the quantity, with any
  dictionary alias replaced by its English name ("pyaz" → "onion"). If that yields no
  confident match, the row is retried once with the user's original words.

### Matching

A listing matches a row only if all three hold:

1. **Same kind of product.**
   - The row's head noun (or an alias) is the listing's head noun, so "milk" never matches
     "milk chocolate", "milk powder" or "milk bikis".
   - Where the app supplies a category, it must agree with the dictionary's category hint.
2. **Every required word is present.** Plurals, transliteration variants
   ("masoori"/"masuri") and aliases count. A locked brand must equal the listing's brand
   field, or appear in the title when that field is empty.
3. **Compatible dimension:** mass, volume, count or pack.

Each match gets a 0–1 score, built the same way as med-compare's scorer.
- At or above `MATCH_CONFIDENCE_FLOOR` (0.55): a fill candidate.
- 0.35–0.55: shown as "possible match — use this?". Accepting one pins it.
- Below 0.35: dropped.
- A pin restricts that row on that app to the pinned product.

### Pack fills

For each row, each app and each **product line** (same brand and product with the size
removed, e.g. Aashirvaad Atta in 1, 5 and 10 kg), using in-stock listings only:

- Choose the combination of packs with the lowest cost such that
  `requested ≤ quantity ≤ 1.25 × requested`.
- If no combination fits under the cap, take the smallest quantity ≥ requested and mark
  it `overBuy`.
- At most 12 packs. Ties go to less quantity, then to fewer packs.
- Solved by a small dynamic program over quantity, in steps of the gcd of the pack sizes.

The candidate fills for a (row, app) pair are the cheapest fill of each product line,
keeping the 3 lowest costs. A locked row only considers lines of its brand. Offering the
optimizer more than one fill is what lets it choose, say, a ₹5 dearer brand when that
tips an order over free delivery.

### Fee model

```ts
type FeeRule =
  | { kind: 'flat';   label: string; amount: number }                     // every order
  | { kind: 'below';  label: string; amount: number; threshold: number }  // when subtotal < threshold
  | { kind: 'tiered'; label: string; tiers: { from: number; amount: number }[] };
                                                     // amount of the highest tier with from ≤ subtotal
interface FeeSchedule {
  platformId: PlatformId;
  cities: string[] | 'default';
  minOrder: number | null;                           // cannot check out below this
  rules: FeeRule[];
  variants: { id: 'peak' | 'late_night'; label: string;
              window?: { from: string; to: string }; // 'HH:MM', local time
              rules: FeeRule[]; minOrder?: number | null }[];
  sources: { url: string; date: string; confidence: 'confirmed' | 'uncertain' }[];
  checkedAt: string;
}
interface MembershipEffect {
  membershipId: 'zepto_club' | 'swiggy_one';               // extended as platforms join
  platformId: PlatformId;
  changes: { rule: string; threshold?: number; remove?: true }[];  // e.g. Delivery → threshold 99
}
```

- **The seed catalog** comes from the fee research, one entry per platform, with city
  entries where fees differ by city. Uncertain values display with "≈". Amounts are
  GST-inclusive, as the apps show them.
- **Resolution order** for each (app, store):
  1. user override
  2. a live hint observed in this comparison (e.g. JioMart's `min_basket_value`, a
     "free delivery above ₹199" banner). A hint overrides only the fields it carries.
  3. the catalog's entry for the city
  4. the catalog default
- **Monotonicity invariant.** A resolved schedule's total fee must never rise as the
  subtotal rises. A unit test checks every catalog entry. At runtime, a schedule that
  violates it (e.g. from a bad override) is rejected with a visible error.
- **Variants.**
  - `late_night` applies when the comparison's time (IST) falls inside its window.
  - `peak` (e.g. Zepto's ₹299 threshold) is driven by demand and can't be predicted, so it
    is used only by the peak check.
- **Surge and rain fees** have no amount the app can know in advance. Plans show a warning,
  never a number.
- **Upkeep.** `docs/FEES.md` holds a monthly re-verification checklist. Every entry carries
  `checkedAt`, and the UI shows "fees last checked …".

### Optimizer

**Why not greedy.** "Buy each item where it is cheapest" is wrong as soon as fees exist.
Take Zepto with atta, butter and eggs at ₹189 and Blinkit's onions ₹4 cheaper:
- Buying onions on Blinkit opens a second order (₹30 delivery + ₹9 handling).
- It also leaves Zepto ₹10 short of free delivery, another ₹30.
- Moving the onions to Zepto costs ₹4 and saves ₹69 in fees, so the basket is ₹65 cheaper
  overall. (Illustrative numbers.)

**Formulation.** A mixed-integer program solved exactly with HiGHS, via the `highs`
WebAssembly package, in-process.

- Inputs:
  - rows *I* with at least one fill anywhere
  - apps *P* that are reachable, serviceable and not excluded
  - fills *F(i,p)*
  - resolved fee schedules
- **Fee tiers.** The breakpoints of an app's resolved rules (every `below` threshold, every
  `tiered.from`, and 0) cut [0, ∞) into intervals *k*. Each interval has a lower bound
  *L[p,k]* and a constant fee *φ[p,k]*, where φ never rises as *k* rises.

```
variables   x[i,p,f] ∈ {0,1}   row i bought on app p with fill f
            u[p]     ∈ {0,1}   an order is placed on app p
            z[p,k]   ∈ {0,1}   app p pays fee tier k
            S[p]     ≥ 0       app p's item subtotal

minimise    Σ c[i,p,f]·x[i,p,f]  +  Σ φ[p,k]·z[p,k]  +  ε·Σ u[p]

subject to  ∀i      Σ_{p,f} x[i,p,f] = 1              every buyable row is bought exactly once
            ∀i,p,f  x[i,p,f] ≤ u[p]
            ∀p      u[p] ≤ Σ_{i,f} x[i,p,f]           no empty orders
            ∀p      S[p] = Σ_{i,f} c[i,p,f]·x[i,p,f]
            ∀p      Σ_k z[p,k] = u[p]                 a used app pays exactly one tier
            ∀p      S[p] ≥ Σ_k L[p,k]·z[p,k]          a tier is claimable only once the subtotal reaches it
            ∀p      S[p] ≥ minOrder[p]·u[p]
```

- Because φ never rises as *k* rises, the optimum always claims the highest tier the
  subtotal reaches. The fee charged is therefore exactly the app's fee function at *S[p]*,
  and tiers need no upper bounds.
- ε = 0.001 breaks exact ties in favour of fewer orders. Reported totals exclude it.

**Outputs.** Each output is a solve of the same model with one change:

| Output | Change | Shown as |
|---|---|---|
| `best` | none | the hero plan |
| `fewerOrders` | Σu ≤ k, for k from (orders in `best` − 1) down to 1; stop at the first infeasible k | "2 orders +₹22", "1 order +₹61" |
| exclude app | fix u[p] = 0 (on demand) | the re-solved plan |
| `singleApp[p]` | only app p allowed; rows it lacks are dropped and listed as missing; infeasible below its minimum order | the savings baseline and a sanity check |
| `nudges` | for each locked row, re-solve with it unlocked; report if it saves ≥ ₹5 | "Fortune instead of Aashirvaad saves ₹23 — apply" |
| `peakCheck` | for each app in `best` with a `peak` variant: re-cost `best` under the variant, and re-solve if it gets dearer | "At peak, this costs ₹30 more; plan B would be cheapest" |

- Rows with no fill anywhere are left out of every solve and listed under "Not found
  nearby".
- **Explanations.** For every line whose fill isn't its row's cheapest fill across all
  apps, the engine computes the counterfactual: move the row to its cheapest fill and keep
  everything else. It then recomputes both apps' subtotals, fees and minimum orders, and
  renders the difference as one sentence, e.g. "Blinkit is ₹4 cheaper, but moving it drops
  Zepto below ₹199: +₹30 delivery", or "…opens an Instamart order: +₹39 fees".
- **Headline.** The baseline is the cheapest `singleApp` plan with no missing rows:
  "You save ₹X vs Zepto alone". If no app carries every row, it says "No single app has
  your whole list". If the best plan *is* a single app, it says "Cheapest: everything
  from Zepto" rather than showing a ₹0 saving.
- **Limits.**
  - ≤ 60 rows, ≤ 8 apps, ≤ 3 fills per (row, app).
  - Time limits: 2 s per solve and 6 s per request.
  - Solves run in priority order: `best`, `fewerOrders`, `singleApp`, `peakCheck`, then
    `nudges`. If the request budget runs out, the remaining peak checks and nudges are
    skipped and the UI says so.
  - Any solver status other than Optimal falls back to the single-app table with a message.
    An unproven plan is never presented as the cheapest.
  - Money is rounded to paise on output.

```ts
interface PlanResult {
  best: Plan | null;
  fewerOrders: Plan[];
  singleApp: { platformId: PlatformId; plan: Plan | null; missing: string[]; belowMinOrder: boolean }[];
  nudges: { itemId: string; fill: Fill; saving: number }[];
  peakCheck: { platformId: PlatformId; extraCost: number; alternative: Plan | null }[];
  unavailable: string[];
  baseline: { platformId: PlatformId; total: number } | null;
  solver: { status: 'optimal' | 'fallback'; ms: number };
}
interface Plan  { orders: Order[]; itemsTotal: number; feesTotal: number; total: number }
interface Order {
  platformId: PlatformId;
  lines: { itemId: string; fill: Fill; why: string | null }[];
  subtotal: number;
  fees: { label: string; amount: number; approximate: boolean }[];
  total: number;
  eta: string | null;                                       // "12 min", "today, slot"
}
```

## Fetch worker

- **Transports:**
  - `plain` — undici with browser headers.
  - `impersonate` — an HTTP client with Chrome's TLS and HTTP/2 fingerprint. The candidate
    is `impit`; spike S1 confirms it.
  - `browser` — a Playwright Chromium pool. One session per platform per store area loads
    the site once (clearing the WAF challenge), then runs searches as in-page `fetch`
    calls, so they carry the page's own cookies and origin. Sessions are recycled after a
    failed challenge and every 30 minutes.
- **Adapters.** There is one file per platform, following med-compare's contract.
  - An adapter returns `Listing[]`, and never throws for "no results".
  - It throws `BlockedError` or `TimeoutError` so that statuses stay honest.
  - It refuses rows when the platform reports a different location from the one requested.
    DMart without `storeId` and BigBasket's IP-derived area are the known traps.
  - Selectors and field paths are hoisted to named constants.
- **Store lookup** is cached for 24 h per coordinate rounded to 3 decimals (about 110 m),
  or per pincode.
- **Search cache:** an in-memory LRU keyed by (platform, storeId, normalised query), with a
  15-minute TTL.
- **Politeness:**
  - ≤ 4 concurrent requests per platform, and a 15 s deadline per platform per comparison.
  - A 429 means back off, then report `blocked` if it persists.
  - Searches only happen when a user asks. There is no crawling or enumeration.
- **Client limits,** keyed by the client IP forwarded in the signed request: ≤ 10
  comparisons per 10 minutes and ≤ 60 queries per comparison.
- **Health:** `GET /healthz` checks the service is up. `npm run canary` runs one known
  query per platform and prints each status.

## Results screen

Mobile-first, in med-compare's visual language (shadcn/ui, Geist, Phosphor icons,
light/dark).

- **Headline:** "₹1,240 for everything · 3 orders · you save ₹186 vs Zepto alone".
- **Plan switcher:** *Cheapest* / *2 orders +₹22* / *1 order +₹61*.
- **Plan tab:** one card per order.
  - Each card shows the app and its delivery time, each line with the product and packs
    ("Onion 2 × 500 g"), itemized fees (uncertain ones as "≈"), a subtotal, and
    **Open in Zepto**.
  - A line placed on a dearer app carries its one-line *why*.
  - Over-buys are flagged ("only 800 g packs: you'll get 1.6 kg").
- **All prices tab:** a grid with list rows down the side and apps across the top.
  - Each cell shows the cheapest fill for that (row, app). The plan's picks are
    highlighted, and footer rows show subtotal, fees and total per order.
  - The item column is sticky, and the grid scrolls sideways on phones.
  - Tapping a cell shows the other product lines and possible matches there, where the
    user can pin one.
- **Nudges:** brand swaps apply with one tap, which re-solves. The peak-check warning also
  appears here.
- **Folded sections:**
  - "Not found nearby".
  - "Couldn't reach", e.g. "Instamart: blocked, so this plan uses 4 of 5 apps".
  - "Approximate location" when only a pincode was given.
- **Settings sheet:** memberships, excluded apps, and fee overrides ("My Blinkit fees are
  different").
- **Hand-off checklist per order.** Each product link opens the app via app links on
  phones, and ticks are saved locally. Links go through med-compare's affiliate builder
  where a programme exists. All affiliate environment variables are optional.

## Failure handling

- **Every app shows a status:** ok, no results, blocked, timeout, not serviceable here, or
  error. A plan built without an app says so.
- **Rows are never dropped silently.** They are either in the plan, under "Not found
  nearby", or waiting on a possible-match tap.
- **Bad rows are refused:** a zero or non-numeric price, a per-unit price more than 10×
  (or under a tenth of) the row's median per-unit price across apps, or a location
  mismatch.
- **Solver failure** falls back to the single-app table with a message.
- **Prices carry their age** ("prices from 3 min ago"). Cached results older than the TTL
  are fetched again.
- **If the worker is unreachable**, the app reports that the comparison service is
  unavailable. It never shows a partial plan as complete.

## Security and privacy

- **The worker is private.** It accepts only HMAC-signed requests from `apps/web`.
- **Rate limits** are enforced in the worker. `/api/plan` never touches a platform, and
  gets size caps plus a best-effort limiter per instance.
- **No personal data is stored on the server.** Lists, settings and ticks live in the
  browser, and logs hold per-platform status and latency but not lists.
- **Every boundary is validated** with zod: browser → web, web → worker, and adapter output.

## Testing

All tests use vitest unless stated otherwise.

- **The optimizer against brute force.** Property-based tests generate thousands of random
  baskets (≤ 7 rows × ≤ 4 apps × ≤ 2 fills, random fee schedules that respect the
  monotonicity invariant). Every basket is solved exhaustively as well, and the totals must
  be equal.
- **Optimizer scenarios:**
  - the onion example
  - DMart's flat fee (splitting never pays)
  - stacked delivery and small-cart fees
  - minimum-order infeasibility
  - a row only one app sells
  - `fewerOrders` totals never below `best`'s
  - explanations naming the right fee
  - the nudge threshold
  - the ε tie-break
- **Fees:** each rule shape, membership effects, the order of overrides, variants, and
  catalog monotonicity.
- **Parsing and matching golden tests:**
  - quantity strings
  - Hinglish aliases
  - milk vs milk chocolate / milk powder
  - brand locks
  - required variant words
  - count ↔ mass bridging
- **Pack fills against brute-force enumeration:** the over-buy cap, the 12-pack limit, and
  the tie-breaks.
- **Adapters, offline:** each one parses its captured responses (the probe captures
  first). A live canary runs on demand only.
- **End-to-end:** a Playwright test runs against a fixture-backed fake worker: enter a list
  → plan → switch plans → All prices → apply a nudge.

## Spikes (they gate adapter work)

Each spike ends with a short note in `docs/research/`.

| Spike | Question | Pass | If it fails |
|---|---|---|---|
| S1 | Can `impersonate` reach Blinkit search from the VPS at a set location? | ≥ 9/10 searches return priced JSON | Blinkit moves to `browser` |
| S2 | Can `browser` reach Zepto and Instamart search from the VPS at a set location? | ≥ 9/10 priced searches; a session stays valid ≥ 10 min | S4 |
| S3 | Does BigBasket's listing API honour an explicit lat-long? | prices and stock change with location and match the site there | BigBasket is out of v1 |
| S4 | Does a failing S1/S2 platform pass through an Indian residential proxy? | same pass bar | the platform ships as "unavailable" |
| S5 | Does `highs` load in a Next.js 16 Node route on Vercel? | a 60 × 8 instance solves in < 200 ms warm | run the engine inside the worker |

## Build order

1. **Spikes S1–S5.** They decide transports and hosting, so they come first.
2. **`packages/engine`,** in parallel with the spikes. It needs no network. Build it test
   first, with the brute-force check written before the model.
3. **`apps/fetcher`.** JioMart and DMart first (known to work), then Blinkit, Zepto and
   Instamart on whichever transport their spike chose, then BigBasket if S3 passed.
4. **`apps/web`:** list builder, compare stream, results screen, hand-off.
5. **A canary week against the launch gate below.**

## Success criteria (the Phase 1 launch gate)

1. **Coverage.** At least 2 of Blinkit, Zepto and Instamart, plus JioMart and DMart, return
   priced results through the worker for ≥ 90% of canary searches across 7 consecutive
   days.
2. **Speed.** For a 20-item list in Bengaluru, first app results appear within 5 s and the
   final plan within 20 s on a cold cache (3 s warm).
3. **Correct and fast optimizer.** It matches brute force on every randomized test, and
   solves in ≤ 200 ms at 60 rows × 8 apps.
4. **Every rupee is traceable.** Each amount on screen traces to a listing (with fetch
   time), a fee entry (with source and date), or a user override.
5. **Nothing fails silently.** Every app and every row shows a status.

## Risks

- **Platforms escalate blocking.** Phase 2 is the structural answer, and residential
  proxies (S4) are the stopgap.
- **Terms of service.** Automated access goes against these platforms' terms, as
  med-compare's searches did. Mitigations:
  - searches only when a user asks
  - caching and low concurrency
  - no crawling
  - official feeds or affiliate programmes replace scraping wherever one is offered
- **Fee drift.** Fees are the most volatile input. Mitigations: monthly re-verification,
  live hints, user overrides, and "last checked" dates on screen.
- **Dynamic pricing.** Prices move by the hour, so the TTL is 15 minutes and prices show
  their age.
- **The wrong store is a wrong price.** Adapters refuse rows when the platform serves a
  different location, and pincode-only locations are labelled approximate.

## Stack

- **Web:** Next.js 16 (App Router), TypeScript strict, Tailwind v4, shadcn/ui, Phosphor,
  Geist, next-themes, on Vercel.
  - Next.js 16 has breaking changes. Read `node_modules/next/dist/docs/` before writing
    route code, as med-compare's AGENTS.md says.
- **Worker:** Node 22 with undici, Playwright Chromium and a TLS-impersonation client
  (candidate `impit`), in Docker on a VPS in India.
- **Engine:** TypeScript, with `highs` (HiGHS compiled to WebAssembly) for the optimizer.
- **Everywhere:** zod at every boundary, vitest for tests, Playwright for the end-to-end
  test.

## Build notes (2026-09-27)

Decisions made while building. Where they differ from the sections above,
these win.

- **Spikes.**
  - **S1 Blinkit — pass.** `impit` with its `chrome151` fingerprint got 10/10
    priced searches. Its generic Chrome profile and headless Chromium were both
    challenged, so Blinkit uses `impersonate`, not `browser`
    ([note](../../research/2026-09-27-spike-s1-blinkit.md)).
  - **S3 BigBasket — pass.** Replaying the site's own guest
    "current delivery address" flow moves prices to the requested location,
    so BB Now ships in v1 ([note](../../research/2026-09-27-spike-s3-bigbasket.md)).
  - **S2 Zepto & Instamart** — both return live priced results through the
    `browser` transport; see the S2 note for session lifetime and headless
    behaviour.
  - **S4** has not been needed from a residential IP; S1 and S2 must be re-run
    from the VPS before launch.
  - **S5 — pass.** HiGHS runs inside the Next.js Node route; a 60 × 6 × 3
    basket solves well inside the bound.
- **Pack fills** accept a pack of at least 95% of the amount, so nominal sizes
  like 975 ml count for 1 L. An approximate weight range ("900 g – 1 kg")
  counts as its midpoint.
- **Matching.**
  - Bracketed translations never decide the product type ("Spring Onion
    (Eerulli Soppu)").
  - A multi-word name tolerates one misspelt word when another word matches
    exactly ("Penaut Butter").
  - Multigrain and high-fibre are variants.
- **Brand-locked rows are searched twice**, with and without the brand, so
  nudges and "any brand?" offers have real alternatives to show.
- **Store-lookup cache.** 10 minutes for Blinkit, Zepto and Instamart, because
  they reassign dark stores within minutes. 6 hours for BigBasket, because each
  lookup creates a guest address on their side. 24 hours for the pincode-based
  apps.
- **Name and look.** The UI calls the product "jhola" (a placeholder in
  `apps/web/src/lib/site.ts`). The visual direction moved from med-compare's to
  a neo-brutalist, Gen-Z look (Tailwind v4, Phosphor icons, motion), as the user
  asked.
