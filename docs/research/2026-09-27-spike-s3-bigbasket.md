# Spike S3 — does BigBasket honour an explicit location? — 2026-09-27

**Question (spec, Spikes):** can a plain HTTP client make BigBasket's listing API
price and stock for a location we choose, instead of the caller's IP?

**Verdict: PASS.** The site's own guest "choose location" flow, replayed over plain
HTTP, moves an anonymous session to any lat/lng. For the same query in the same
minute, Bengaluru and Mumbai coordinates land in different service areas, with
different assortment, stock and prices. BigBasket (BB Now) can ship in v1 on the
`plain` transport; the adapter is `apps/fetcher/src/adapters/bigbasket.ts`.

## Method

From an Indian residential IP in Bengaluru, desktop Chrome UA, no login, no
browser. 12 API requests to www.bigbasket.com for the spike itself, 23 static JS
chunks from the bbassets.com CDN to read the site's code, then two adapter runs
(7 requests each).

## How the site sends a location (read from its JS)

The header address widget (dynamic chunks `3147`, `6697`, module 52640) does this
when a guest picks a place:

1. `GET /places/v1/places/details/?placeId=…` → lat/lng (Google Places; not needed
   when we already have coordinates).
2. `GET /ui-svc/v1/serviceable/?lat=<lat>&lng=<lng>&send_all_serviceability=true`
   with `X-Caller: UI-KIRK`, `X-Channel: BB-WEB`. It answers per entry context
   (`bbnow`, `bb-b2c`, …) plus a reverse-geocoded `places_info` (area, pincode,
   city), and sets a `csurftoken` cookie (30 min).
3. For a guest: `PUT /member-svc/v2/member/current-delivery-address/` with
   `{lat, long, return_hub_cookies: false, area, contact_zipcode}` and header
   `X-csurftoken: <csurftoken cookie>`. (Members instead `POST
   /member-svc/v2/address/` with `is_partial: true, set_current_address: true`.)
4. The site then writes `xentrycontext=bbnow` / `xentrycontextid=10` cookies and
   calls `/ui-svc/v2/header`, copying its `additional_cookies` (`_bb_sa_ids`,
   `_bb_pin_code`, `_bb_addressinfo`, …) into cookies.

The listing call itself (`GET /listing-svc/v2/products/?type=ps&slug=…&page=1`)
carries no location parameter; location lives entirely in the session.

## Evidence

A fresh guest session (bootstrapped from `/ps/?q=…`) was put through steps 2–4 for
each point, then searched for "amul butter".

| | Bengaluru 12.9352, 77.6245 | Mumbai 19.1364, 72.8296 | Not located (probe, 14:26) |
|---|---|---|---|
| `serviceable` → `places_info` | 4th Block, Koramangala, 560095 | Shastri Nagar, Andheri West, 400053 | — |
| `bbnow.serviceable` | `bb2.0` | `bb2.0` | — |
| PUT | 200 `{}` | 200 `{}`; set `_bb_lat_long` = base64 "19.1364\|72.8296", `_bb_cid=4`, new `_bb_aid` | — |
| header after PUT | — | address 19.1364 / 72.8296, pin 400053, Mumbai; `_bb_sa_ids` 15950,17830,31353; next slot sa 15950 "5 mins" | address pin 560004 (IP) |
| listing rows `visibility` | **sa 18648 / fc 1744** (12 of 12) | **sa 15950 / fc 1478** (17 of 17) | sa 19224 / fc 1820 |

Same 15 SKUs seen in both cities, same minute:

- **Price:** Amul Choco Buttery Spread 200 g — ₹125 in Bengaluru, ₹120 in Mumbai.
- **Stock:** 6 SKUs in stock in Bengaluru and out in Mumbai (Amul Lite Milk Fat Bread
  Spread 100 g and 500 g, Milky Mist Cooking Butter 100 g and 200 g, Amul Unsalted
  Butter 100 g, Plantacious Vegan Butter 200 g).
- **Assortment:** Mumbai only: Parsi Dairy Farm, President, Amul White Lactic
  Butter. Bengaluru only: Nandini, Akshayakalpa, Hatsun. These are the regional
  dairies you would expect in each city.

The adapter's own live runs later that afternoon repeated the result on other
queries. Toor dal:
Tata Sampann 500 g ₹87 in Bengaluru vs ₹103 in Mumbai; bb Royal 500 g ₹90.48 vs
₹92.04; bb Super Saver 1 kg ₹131 vs ₹136. fresho! Onion 1 kg: ₹76 vs ₹63.

## Things that did not work, or changed

- **A `_bb_lat_long` cookie alone** (no guest session) → HTTP 404
  `{"errors":[{"code":5012,"msg":"2 exceptions occurred. "}]}`. The full flow is
  needed.
- **The pincode cookie** is still ignored (probe, and med-compare 2026-09-19).
- **Nonsense queries** now return **HTTP 204 with an empty body**. On 2026-09-19
  (med-compare) they returned 40 LLM-guessed rows with `is_llm_flow: true`. The
  adapter maps 204 → no results and keeps the `is_llm_flow` guard. The shared
  `plainJson` would have reported the 204 as `blocked` ("expected JSON"), which is
  why this adapter parses responses itself.

## How the adapter uses this

- `resolveStore` = bootstrap → serviceable → PUT → header. That is 4 requests,
  cached 24 h per ~110 m cell by `search.ts`.
  - It returns `null` when `bbnow.serviceable` is `NA`, `bb1.0` or missing.
  - It throws if the header places the session more than about 50 m from the
    requested point.
  - The store carries the session cookies, the lat/lng, and the verified service
    area ids.
- `search` sends that session. It refuses the whole response (`UpstreamError`) if
  any row or pack-size child has a `visibility.sa_id` outside the verified set.
  Replayed against the probe's IP-located rows (sa 19224) with a Mumbai session,
  the parser refuses them (unit test).
- If a session older than 5 minutes produces an `errors` payload or foreign rows,
  `search` re-runs the flow once and retries.

## Caveats

- **"Match the site there"** was not checked with a real browser in Mumbai. The
  flow is the site's own code path, so a browser at that location should see the
  same thing, but this is by construction, not by observation.
- **Unserviceable coordinates** (a BB Now `NA`) were not tested live. The `null`
  path is covered only by a unit test.
- **Each store resolution creates a guest visitor and a partial address** on
  BigBasket's side, just as a person choosing a location does. At one per cell per
  day that is modest, but it is a write, not a read.
- **robots.txt** disallows `/ps/` (the bootstrap page), same as med-compare's
  adapter. `/ui-svc/`, `/member-svc/` and `/listing-svc/` are not mentioned.
- **Session lifetime is unknown.** The cookies claim 2027/2046. The adapter
  re-locates on failure rather than trusting that.
- **No fee facts** appear in these responses (header `ticker_info` and
  `special_notifications` are empty), so BB Now fees come from the catalog.
