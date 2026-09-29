# jhola

Paste your grocery list. jhola finds the cheapest way to buy all of it across
Blinkit, Zepto, Swiggy Instamart, JioMart, DMart Ready and BB Now — splitting
it across apps only when that actually saves money once **delivery, handling,
small-cart fees and minimum orders** are counted.

> “Buy each item where it’s cheapest” is wrong as soon as fees exist: an extra
> order costs ₹30–54 in fees, and every split can leave an order just under its
> free-delivery threshold. jhola solves the whole basket at once, exactly.

## Run it

```bash
npm install
npx playwright install chromium   # once: the browser transport for Zepto & Instamart
npm run dev
```

Open **http://localhost:3100**. `npm run dev` starts both processes:

| Process | Port | What it does |
|---|---|---|
| `apps/web` (Next.js 16) | 3100 | UI, `/api/compare` (streams), `/api/plan`, `/api/locate`, the optimizer |
| `apps/fetcher` (Node) | 4100 | the only thing that talks to grocery platforms |

No database, no accounts. Your list, location and settings stay in your
browser; prices are fetched live, and a result is reused for at most a minute.

## Made for fewest taps, anywhere in India

- **Real products as you type.** Three letters in the add box shows live
  products from the apps near you, with photos, every app's price and the
  price per unit (₹/kg, ₹/100 g, ₹/L, ₹/pc) in one unit per list, so a 500 g
  pack and a 100 g pack compare at a glance; the cheapest per unit among true
  matches is tagged *best value*. Regional names work ("vengayam", "pyaz").
- **Live prices.** Nothing older than a minute is reused, and a results page
  left open re-checks itself when you come back after five minutes.
- **No questions up front.** Location comes from GPS when the browser already
  allows it, otherwise from the network (city-level, no prompt); GPS is asked
  for only when you tap compare. A shared list, a pasted list or a returning
  visitor's list is priced without a tap. Fees and memberships are optional.
- **Your own account's prices.** "Your apps" on the landing page logs in to
  Zepto and Swiggy Instamart through their official MCP sign-in (OAuth + PKCE,
  on the app's own page). A comparison carries the shopper's token and the
  server searches their own account over the app's MCP (saved address matching
  the delivery place, then `search_products`), replacing that app's logged-out
  prices, which also sidesteps the firewalls that meter our server. Prices are
  unit-checked against the other apps (a paise/rupee slip is corrected). The
  greeting's first name comes from Zepto's `get_user_details`. Blinkit,
  BigBasket, JioMart and DMart have no official sign-in for other apps.
  `/connect` shows a connected app's tools and one search, raw and as read.
- **Fees nobody types.** Logged in, a comparison also reads the shopper's own
  fees and membership from their account (latest order bills, store rules,
  Instamart's live cart), read-only, cached per sign-in for 30 minutes; the
  settings sheet only shows where each app's fees came from.
- **One-tap cart.** The order sheet starts with everything in (× drops an
  item). For Instamart with a login, "Add N to cart & open Instamart" fills the
  real cart through Swiggy's `update_cart` (merged with what's there; left
  alone if the cart can't be read). Zepto's MCP cart never reaches the app
  (zeptonow/mcp#62), and the other apps have no cart API, so they open with
  each item linked to its product page.
- **Polite to the apps.** An app that refuses us rests (2 → 4 → … 20 min)
  instead of being retried into a longer ban; block-prone apps get one search
  per row; the typing box only asks the fast apps.
- **Pan-India.** Stores are found from each visitor's own coordinates and
  pincode; `npm run coverage -w @gc/fetcher` checks every app across 16 cities
  from Delhi to Kochi and Guwahati to Ahmedabad.

## How it works

```
list rows ──▶ parse (brand, product, required words, Hinglish → English)
          ──▶ fetcher: store lookup + search on every app, in parallel
          ──▶ match (same product? brand? variant?) ──▶ pack fills (cheapest packs ≥ amount)
          ──▶ optimizer: mixed-integer program over rows × apps × fills × fee tiers (HiGHS)
          ──▶ best plan · fewer-order plans · single-app baseline · peak check · brand-swap nudges
```

- **Step-up packs.** Besides each product's cheapest pack combination, the
  optimizer may take the next size up (never more than +25% of what was asked)
  when the bigger pack costs less than the fee it avoids, e.g. a 6 kg atta
  instead of 5 kg that clears ₹199 free delivery. It's tagged on the order.
- **Remove an app, re-plan instantly.** The × on an order card re-solves
  without that app (this plan only, with Undo), from the prices already in hand.
- **The optimizer is exact.** Each app’s fees become step functions of its
  order subtotal; the model is solved by HiGHS (WebAssembly) and checked
  against brute-force enumeration on thousands of random baskets in the test
  suite. See `packages/engine/src/optimize/solver.ts` for the formulation.
- **Explanations.** Any item placed on a dearer app says why: “Blinkit sells it
  ₹4 cheaper, but moving it drops Zepto below ₹199 (+₹30 delivery)”.
- **Honest failures.** An app that is blocked, slow or not serviceable is named
  on the plan; nothing is dropped silently.

## Platforms

| App | Transport | How location works |
|---|---|---|
| Blinkit | `impersonate` — Chrome TLS fingerprint via `impit` | lat/lon headers |
| Zepto | `browser` — Playwright Chromium clears the AWS WAF challenge | lat/lng → store id |
| Instamart | `browser` | lat/lng → dark-store pods |
| JioMart | `plain` | pincode → store uid |
| DMart Ready | `plain` | pincode → store id header |
| BB Now | `plain` | lat/lng → guest delivery address |

Evidence and spike notes live in `docs/research/`. Choose platforms with
`GC_PLATFORMS=blinkit,zepto,…`.

## Scripts

```bash
npm test                                  # engine + fetcher tests (vitest)
npm run typecheck
npm run canary -w @gc/fetcher             # one live search per platform
npm run coverage -w @gc/fetcher           # which apps deliver where, 16 places across India
npx tsx apps/fetcher/src/try.ts zepto "amul butter|toor dal" 560034 12.9352 77.6245
node scripts/demo.mjs /tmp/demo           # drive a full comparison in a browser
node scripts/suggest-check.mjs /tmp/s     # live products while typing, phone + desktop
node scripts/flow-check.mjs /tmp/f        # zero-tap flows: shared link, returning visitor, paste
```

## Layout

```
apps/web          Next.js app (Vercel)
apps/fetcher      platform worker (Docker, small VPS in India)
packages/engine   pure TypeScript: quantities, matching, fills, fees, optimizer
docs/             spec, research, fee checklist
```

## Analytics (Google Analytics 4)

The tag loads only when a measurement ID is set (`NEXT_PUBLIC_GA_ID`, or
`SITE.gaId` in `apps/web/src/lib/site.ts`); Google signals and ad
personalisation are off, and the privacy page has an off switch. No names,
phones, addresses, pincodes or coordinates are sent; typed items are reduced to
the grocery item's name. Events (see `apps/web/src/lib/analytics.ts` callers):

| Event | When | Parameters |
|---|---|---|
| `search` | an item is added from the add box | `search_term`, `results` |
| `add_to_list` | product pick, generic item, typed, quick add, sample, paste | `method`, `item`, `app`, `price`, `brand_locked`, `count`, `list_size` |
| `remove_from_list`, `clear_list`, `brand_toggle`, `any_brand`, `pin_product` | list edits | `item`, `app`, `count`, `list_size` |
| `compare_start` | a comparison begins | `trigger`, `item_count`, `accounts`, `location_source`, `approximate` |
| `compare_complete` (key event) | final plan | `value`, `currency`, `savings`, `savings_pct`, `fees`, `orders`, `item_count`, `items_found`, `apps_in_plan`, `cheapest_single_app`, `apps_ok`, `apps_blocked`, `apps_unserviceable`, `apps_account`, `duration_ms`, `trigger` |
| `compare_error` | a comparison fails | `trigger`, `reason` |
| `select_plan` | a fewer-orders plan is picked | `orders`, `extra_cost` |
| `begin_checkout` (key event) | "Order on <app>" | `value`, `currency`, `app`, `items[]` |
| `open_app` | the app is opened from the order sheet | `app`, `value` |
| `login_start`, `login` (key event), `logout` | Zepto / Instamart account | `method` |
| `location_set` | how the place was found | `method`, `approximate` |
| `share` | list or savings shared | `method`, `content_type` |
| `settings_change`, `bill_read` | settings | `setting`, `count`, `app` |
| `web_vitals` | page speed | `metric_name`, `metric_value`, `metric_rating` |

User properties: `accounts_connected`, `theme`, `installed_app`.

This deployment: account **jhola** (409952109) → property **jhola**
(556500858, Asia/Kolkata, INR) → web stream **G-XFT6C4QQ24**, linked through the
Firebase project `jhola-analytics-cml19`, whose service account
`jhola-ga@jhola-analytics-cml19.iam.gserviceaccount.com` is an Editor there.

- **Debug:** add `?ga_debug=1` to any URL (or set localStorage
  `jhola:ga-debug` = `1`) to send in debug mode → Admin → DebugView. Debug
  events are kept out of reports.
- **Tests and bots aren't counted:** browsers driven by automation
  (`navigator.webdriver`) send nothing unless localStorage `jhola:ga-test` = `1`.
  `node scripts/ga-check.mjs` opts in, uses the app like a shopper and prints
  every event and parameter it sends.

`scripts/ga-setup.mjs` creates (or finds) the property, web stream, every
custom dimension/metric above, 14-month retention and the key events, through
the Admin API. Google blocks the gcloud CLI's own login from Analytics scopes,
so it runs as a service account the CLI impersonates:

```bash
gcloud auth login
gcloud projects create jhola-analytics-XXXXX
gcloud services enable analyticsadmin.googleapis.com analyticsdata.googleapis.com iamcredentials.googleapis.com --project jhola-analytics-XXXXX
gcloud iam service-accounts create jhola-ga --project jhola-analytics-XXXXX
gcloud iam service-accounts add-iam-policy-binding jhola-ga@jhola-analytics-XXXXX.iam.gserviceaccount.com \
  --member=user:YOU@gmail.com --role=roles/iam.serviceAccountTokenCreator
# In Google Analytics: Admin → Account access management → add the service account as Editor.
GA_TOKEN=<token from iamcredentials generateAccessToken with the analytics.edit scope> node scripts/ga-setup.mjs https://your.domain
```

## SEO

- **Pages:** the app (`/`), a fee table for every app (`/fees`) and 15
  head-to-head pages (`/compare/blinkit-vs-zepto`, …), all prerendered from
  the same fee catalog the planner uses, with dated sources. The home page has
  a collapsed "how it works · apps · comparisons · FAQ" section under the app.
- **Metadata:** per-page titles (`%s · jhola`) and descriptions sized for
  search results, canonical URLs, Open Graph/Twitter cards with per-page share
  images, `robots` rules (utility pages `/callback` and `/connect` are
  noindex), `sitemap.xml` and `robots.txt`.
- **Structured data:** WebSite, WebApplication (free, India), Person and
  FAQPage on the home page; BreadcrumbList and WebPage on content pages.
- **Check:** `node scripts/seo-check.mjs [base-url]` prints what a crawler sees
  on each page and fails on missing titles, canonicals or bad JSON-LD.

To go live: set `NEXT_PUBLIC_SITE_URL` to the public origin (on Vercel the
production URL is used automatically), optionally `GOOGLE_SITE_VERIFICATION`
and `BING_SITE_VERIFICATION`, then add the site in Google Search Console and
Bing Webmaster Tools and submit `https://<domain>/sitemap.xml`.

## Going live with account logins

Localhost works as is. For a public domain, each app must allow its
`https://<domain>/callback` redirect:

- Zepto: open an issue on [zeptonow/mcp](https://github.com/zeptonow/mcp/issues)
  asking to whitelist the redirect URI (others have done the same).
- Swiggy Instamart: join the Swiggy Builders Club
  ([quickstart](https://mcp.swiggy.com/builders/docs/start/developer/)); production
  access follows a validated staging integration, and redirect URIs are
  whitelisted via [Swiggy/swiggy-mcp-server-manifest](https://github.com/Swiggy/swiggy-mcp-server-manifest/issues).

## Known limits

- Prices are what a logged-out shopper sees; member-only prices and coupons
  are not included. Fees come from the catalog (`packages/engine/src/catalog.ts`)
  and can be overridden in the app — re-verify monthly (`docs/FEES.md`).
- Surge, rain and late-night fees can’t be known in advance and are never
  included in totals.
- Automated access sits against these platforms’ terms. Searches only run when
  a person asks, a result is reused for up to a minute, and there is no crawling.
