# Spike S1: Blinkit through Chrome-TLS impersonation (2026-09-27)

**Question (from the design spec):** can the `impersonate` transport reach Blinkit
search at a set location? **Pass:** ≥ 9 of 10 searches return priced JSON.

**Verdict: PASS from this machine, 10 of 10.** Every search in the S1 run returned HTTP
200 JSON with 12 priced product cards and no challenge. So did all 10 other impit searches
made today: the first probe, the no-results probe, 6 end-to-end and 2 in the long-lived
check. Blinkit ships on `impersonate` (impit, `chrome151` profile). This has **not** been re-run from the
VPS; see the caveats.

## Method

- **Where from:** the same Indian residential IP in Bengaluru as the
  [platform probe](2026-09-27-platform-probe.md). On that probe every plain request from
  this IP got 403 `cf-mitigated: challenge`, robots.txt included.
- **Client:** `impit` 0.14.5 through `apps/fetcher/src/transports/impersonate.ts`
  (`createImpersonator({ browser })`).
  - No cookie jar, and no cookie carried over from earlier responses.
  - No `auth_key`, no login, no proxy, no CAPTCHA solving.
- **Locations:**
  - Koramangala, Bengaluru: 12.9352, 77.6245 (560034).
  - Andheri West, Mumbai: 19.1364, 72.8296 (400053).
  - Unserviceable control: Kavaratti, Lakshadweep, 10.5667, 72.6417.
- **Learning the request format:** I read three of the site's public JS bundles (`main`,
  `layout`, one route chunk) for API paths and the headers their `fetchAction` sends. I
  also made one attempt to watch the site's own traffic in headless Chromium; it was
  challenged (see below).
- **Traffic:** 49 requests to blinkit.com in all:
  - 38 through impit, including the 3 of the long-lived check (see "Session lifetime");
  - 11 from the single headless-Chromium page load, mostly Cloudflare challenge assets.

## What happened, in order (IST)

| Time | Client | Request | Result |
|---|---|---|---|
| 15:35:48 | impit `chrome` | `GET /` | **403**, `cf-mitigated: challenge`, `server: cloudflare`, `cf-ray …-BOM`, 565 KB "blinkit \| Error Page" |
| 15:35:59 | impit `chrome` | `GET /v1/layout/search?q=amul+butter&search_type=type_to_search` | **404**, `text/plain` "404 page not found", `cf-cache-status: DYNAMIC`, no challenge. It reached the origin; the route is not GET |
| 15:36:00 | impit `chrome151` | `GET /` | **200**, real HTML (56 KB); sets `gr_1_deviceId`, `city`, `__cf_bm`, `_cfuvid` |
| 15:36–15:39 | impit `chrome151` | 3 JS bundles | 200 each, no challenge |
| 15:38:11 | Playwright Chromium, **headless** | `/` then `/s/?q=amul butter` | **403 challenge** on both; the page title stayed "Just a moment…" after 4–6 s; Cloudflare `challenge-platform` scripts loaded (200) but never cleared |
| 15:38:34 | impit `chrome151` | `POST /v1/layout/search?q=amul%20butter&search_type=type_to_search`, body `{}` | **200** `application/json`, 184 KB, `is_success: true`, 12 product cards, 500 ms |
| 15:40:53 | impit `chrome151` | `GET /v1/consumerweb/eta`, lat/lon = Koramangala | 200: `eta_in_minutes: 13`, express merchant **40076** |
| 15:41:30 | same | lat/lon = Andheri West | 200: express merchant **33684** |
| 15:41:31 | same | lat/lon **headers** = Andheri West, `gr_1_lat/lon` **cookies** = Koramangala | 200: 33684, the Mumbai answer, so **the headers win** |
| 15:41:31 | same | lat/lon = Kavaratti | 200: `status_code: "Non Serviceable"`, no merchant |
| 15:43:32–49 | impit `chrome151` | **S1 run**: 10 searches, 1.5 s apart | **10 × 200, 10 × 12 priced cards** (table below) |
| 15:44:36 | impit `chrome151` | ETA, Andheri West again | express merchant is now **47074** |
| 15:44:50 | same, the 15:41 minimal headers | ETA, Andheri West | 47074 again. The store was reassigned; the headers made no difference |
| 15:45:47 | impit `chrome151` | search `xqzvbnmwk` | 200, `is_success: true`, one `separator_v2_data` snippet, `search_result_count: "0"` |
| 15:47:16 | impit `chrome151` | `GET /prn/tata-sampann-unpolished-toor-dal-togari-bele/prid/39493` | 200; the canonical link equals our URL byte for byte |
| 15:47:47 | impit `chrome151` | `GET /prn/fortune-unpolished-arhar-dal-toor-dal-togari-bel/prid/442163` (not the canonical slug) | 200, so the prid is what resolves |
| 15:55–15:57 | adapter via `src/try.ts` | Bengaluru, then Mumbai: store + 3 searches each | all ok (below) |
| 15:57:23 | impit `chrome151` | `GET /robots.txt` | 200: `Disallow: /s/*` (the HTML search page), nothing under `/v1/` |

### The S1 run

| # | Location | Query | HTTP | Time | Priced cards | Card merchants | First card (₹ cart price = ₹ display text) |
|---|---|---|---|---|---|---|---|
| 1 | Koramangala | toor dal | 200 | 625 ms | 12 | 40076 | Tata Sampann Unpolished Toor Dal (Togari Bele), 1 kg, ₹169 |
| 2 | Koramangala | onion | 200 | 441 ms | 12 | 40076, 37746 | Onion (Eerulli), 1 kg, ₹66 |
| 3 | Koramangala | aashirvaad atta | 200 | 397 ms | 12 | 40076 | Aashirvaad High Fibre Atta with Multigrains, 10 kg, ₹638 |
| 4 | Koramangala | full cream milk | 200 | 409 ms | 12 | 40076, 37746 | Amul Gold Full Cream Milk, 500 ml, ₹34 |
| 5 | Koramangala | eggs | 200 | 314 ms | 12 | 40076, 37746 | Abhi Vitamin D3 White Protein Rich Eggs, 24 pcs, ₹316 |
| 6 | Koramangala | basmati rice | 200 | 520 ms | 12 | 40076, 45326 | Daawat Super Basmati Rice, 5 kg, ₹832 |
| 7 | Andheri West | amul butter | 200 | 360 ms | 12 | 47074 | Amul Salted Butter, 100 g, ₹63 |
| 8 | Andheri West | toor dal | 200 | 375 ms | 12 | 47074 | 24 Mantra Organic Tur / Arhar Dal, 1 kg, ₹196 |
| 9 | Andheri West | onion | 200 | 434 ms | 12 | 47074 | Onion (Kanda), 1 kg, ₹63 |
| 10 | Andheri West | maggi | 200 | 312 ms | 12 | 47074 | Maggi 2 Minutes Instant Noodles, 420 g, ₹79 |

The raw log also has a line "S1 result: 6/10". It comes from a stricter check I added: the
card merchants had to fall inside the merchant set that the ETA endpoint returned
**at 15:41**. The four Mumbai searches failed that check because Andheri West's store had
moved from 33684 to 47074 by 15:43. A fresh ETA call (15:44) listed 47074, so all 10 pass
against the ETA answer current at the time. They also pass the actual criterion: priced
JSON for a set location.

**Latency:** 312–625 ms per search (median ≈ 400 ms). The ETA call takes 290–490 ms. End
to end, `src/try.ts` needed 1.0 s (Bengaluru) and 0.8 s (Mumbai) for store lookup plus 3
concurrent searches.

## The API as observed

- **Search:** `POST https://blinkit.com/v1/layout/search?q=<term>&search_type=type_to_search`.
  - Body `{}`, which works; the web client's own body was not observed.
  - Headers sent are what the site's `fetchAction` sends:
    - `app_client: consumer_web`, `app_version: 52434332`;
    - `web_app_version: 1008010016`, `platform: desktop_web`;
    - `device_id`: 16 hex characters;
    - `lat`, `lon`;
    - plus `gr_1_lat` / `gr_1_lon` cookies.
  - Page 1 has 12 product cards (`product_card_snippet_type_2`) mixed with a header,
    filters, "Similar brands" and carousels.
  - Some queries append a **"Showing related products"** header followed by padding:
    tomatoes for "onion".
- **Store / serviceability:** `GET /v1/consumerweb/eta` with the same headers returns:
  - `eta_in_minutes`;
  - `title` ("Delivery in 13 minutes");
  - `update_eta_action.update_eta.merchant_info` (`{type: "express", id: "40076"}`);
  - `eta_map_v2`, keyed by every merchant serving the point (Koramangala: 40076 express,
    37746 super_longtail, 45326 longtail, 35940 instant).
  - An unserviceable point returns `status_code: "Non Serviceable"`.
- **Location:** only the `lat`/`lon` headers count (cookies lose when they disagree). A
  search response carries **no** location echo: no lat/lon, city or locality. The only
  location evidence is each card's `merchant_id`.
- **Card fields:**
  - `identity.id`, `name.text`, `brand_name.text`, `variant.text` (pack size);
  - `normal_price.text` ("₹66"), `mrp.text`;
  - `atc_action.add_to_cart.cart_item.{price, mrp, unit, merchant_id}`;
  - `product_state`, `inventory`, `is_sold_out`, `image.url`, `eta_tag`;
  - `tracking.common_attributes.ptype` (product type);
  - `variant_list`: the line's other pack sizes, each a full card, and it repeats the
    card itself.
- **Prices are rupees:** on 223 of 223 cards the integer `cart_item.price` equals the ₹
  display text.
- **Stock:** out-of-stock variants had `product_state: "out_of_stock"` and
  `inventory: 0` while `is_sold_out` stayed `false`.
- **Quantities:** the engine's `parseQuantityText` parses all 40 distinct `variant` texts
  seen ("500 g", "2 x 1 kg", "10 x 200 ml", "24 pcs", "1 ltr").

## Location changes the results

Same three queries through the adapter, a minute apart:

| | Koramangala (560034) | Andheri West (400053) |
|---|---|---|
| Store | merchant 40076, "11 mins" | merchant 47074, "8 mins" |
| Onion 1 kg | Onion (Eerulli), ₹66 (MRP ₹75) | Onion (Kanda), ₹63 (MRP ₹80) |
| Tata Sampann Unpolished Toor Dal 1 kg | ₹169 | ₹179 |
| Top "amul butter" hit | Amul Lite Milk Fat Spread 100 g, ₹50 | Amul Salted Butter 100 g, ₹63 |
| Toor dal brands only here | Whole Farm, Popular Essentials | Satyam, Rajdhani, Amul Organic |

## Session lifetime

There is no session. Each impit request stands alone, and no cookie from an earlier
response is sent. `chrome151` requests succeeded from 15:36 to 16:09 IST.

In a separate check, one process kept one impit client and one cached store:

- 15:57:59: store resolved (merchant 40076, "11 mins"), then "milk": 422 ms, 17 listings.
- 16:09:00, 11 minutes later, same client and same cached store: "bread": 704 ms, 13
  listings, no challenge. The merchant check passed without a refresh.

What does expire is the store assignment. Blinkit moved Andheri West's express store from
33684 to 47074 within three minutes. The adapter therefore re-resolves the merchant set
once before refusing a page whose merchants look foreign.

## Caveats

- **Residential IP only.** Cloudflare scores datacenter ranges differently, and the design
  spec asks S1 to pass *from the VPS*. Re-run the S1 script (10 searches) there before
  launch. If it fails there, the next step is S4 (a residential proxy). `browser` is not
  a fallback: headless Chromium was challenged here even from a residential IP.
- **This IP may already be flagged.** Plain requests got 403 on every path, including
  robots.txt, which returned 200 on 2026-09-19. impit getting through anyway is
  encouraging, but a cleaner IP might also let plain requests through, and a flagged IP
  might tighten further.
- **Fingerprint drift.** impit's generic `chrome` profile was challenged on the homepage
  HTML, though not on the API path; `chrome151` passed everything. The adapter pins
  `chrome151`. When Chrome moves on, update impit and try the newest profile first.
- **Headed Chromium was not tried.** It was not needed once impit passed.
- **Not observed:** the web client's real search body.
- **A card's leading pack size can change between requests.** "toor dal" led with the
  Tata Sampann 1 kg card at 15:43 and with its 500 g variant at 15:55. The adapter returns
  every pack size on page 1 (up to 24 listings), so the engine sees the same set either
  way.
- **Politeness:** page 1 only; ≤ 4 concurrent searches per platform (the runner's limit).
  robots.txt disallows the HTML `/s/*` page, which the adapter never fetches. It only sets
  a `/s/?q=` Referer, as the browser does. `/v1/` is not listed.
