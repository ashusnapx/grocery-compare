# Platform reachability probe — 2026-09-27

**Question:** which grocery platforms can a plain server-side HTTP client (curl / Node
fetch, no browser, no login) query for *priced search results at a chosen location*?

**Method:** from an Indian residential IP in Bengaluru, using med-compare's `http.ts`
headers (Chrome/124 UA, `accept-language: en-IN`). 60 requests, 8–11 per platform,
robots.txt included. No challenge solving, no logins, no TLS impersonation, no
headless browsers. Raw JSON responses and the request log are in
[`2026-09-27-probe-captures/`](2026-09-27-probe-captures/).

Prior evidence: med-compare's adapters (probed 2026-09-19) for Blinkit, Zepto,
Instamart and BigBasket.

## Summary

| Platform | Reachable | Endpoint that returned priced results | How location is passed | Fields | Fee / min-order seen | Blocking |
|---|---|---|---|---|---|---|
| BigBasket | **yes, but wrong location** | `GET /listing-svc/v2/products/?type=ps&slug=<term>&page=1` after `GET /ps/?q=` for guest cookies | IP-derived (`_bb_aid`, `_bb_sa_ids`); pincode cookie ignored | MRP, SP, ₹/100 g, `w` net qty, stock, image, `/pd/` URL | "FREE delivery (limited period)" text only | none |
| JioMart | **yes** | `GET www.jiomart.com/ext/vertex/application/api/v1.0/products?q=<t>&f=journey:quickcommerce:::store_ids:<uid>&page_size=12` | pincode → store uid (`delivery-promise`, `x-location-detail` header) → store filter in the search URL | SP, MRP, net qty + ₹/kg, `sellable`, `store_ids`, image, slug | `min_basket_value: 99`; "Delivery in 30 mins" | none |
| DMart Ready | **yes** | `GET digital.dmart.in/api/v3/search/<t>?page=1&buryOOS=true&size=40&channel=web` | pincode → `POST /api/v2/pincodes/details` → `storeId` request header | MRP, sale price, variant, ₹/g, `invStatus`, image key, `/pdp/<id>` | static text "free delivery … from ₹299" | none |
| Amazon Fresh | partial | `GET /s?k=<t>&i=nowstore` (HTML) | pincode bound to session via `POST /gp/delivery/ajax/address-change.html` | price, M.R.P., ₹/kg, ASIN, image | "FREE delivery … on orders over ₹149" | none, but with a location set results were empty |
| Flipkart Grocery | partial | `GET /search?q=<t>&marketplace=GROCERY` (`__INITIAL_STATE__`) | pincode bound to session via `1.rome.api.flipkart.com/api/3/marketplace/serviceability` | finalPrice, mrp, deliveryCharge, availability, pack size | `deliveryCharge` 0 | none; catalogue too thin to use |
| Flipkart Minutes | no | – | pincode check "not available" | – | – | 301 → `/hyperlocal-preview-page` |
| Blinkit | **no** | – | lat/lon cookies + headers (med-compare) | – | – | 403 + `cf-mitigated: challenge` (Cloudflare), now on every path including robots.txt |
| Zepto | **no** (search) | – | lat/lng → storeId via `api.zepto.co.in` still works | – | – | 202 + `x-amzn-waf-action: challenge` (AWS WAF), 0-byte body |
| Instamart | **no** (search) | – | lat/lng `select-location/v2` still works | – | – | 202 + `x-amzn-waf-action: challenge` (AWS WAF) |

## Per-platform notes

### BigBasket
- Observed:
  - Guest session lands in `_bb_sa_ids=19224`; `_bb_cda_sa_info` decodes to
    `v2.cda_sa.10.19224` (BB Now, door 10). `_bb_pin_code` comes back empty.
  - "toor dal": 40 of 711 products returned; "amul butter": 29.
  - Setting `_bb_pin_code=110001` returned 40/40 identical prices, same service area and
    fulfilment centre (`sa 19224` / `fc 1820`). **Location follows the caller's IP, not the
    pincode.**
  - `/ui-svc/v2/header` shows a partial guest address and two doors: `bbnow` (open,
    "10 mins") and `bb-b2c` slotted (door id 100, `door_status 0`). Sending the slotted
    door as `x-entry-context-id` / `x-entry-context` (header, then cookie + header) still
    returned BB Now rows.
  - `rsp` (174) appears beside `sp` (165) with `dual_pricing:true`; meaning unknown.
  - robots.txt disallows `/ps/` (the bootstrap page) and does not mention `/listing-svc/`.
- Inferred: anonymous access yields BB Now prices for the server's own area only. The
  listing API's 400 message — "Missing either Mid or AddressId or lat-long" — suggests an
  explicit lat-long may be accepted; untested.

### JioMart (runs on the Fynd platform)
- Observed:
  - `/search/<term>` server-renders no products. The page embeds a public
    `applicationID` / `applicationToken`; the client sends
    `Authorization: Bearer base64(id:token)`. No request signature needed.
  - The Fynd products endpoint 302s to `/ext/vertex/...`, which 404s on
    `api.jiomartjcp.com` and 200s on `www.jiomart.com`.
  - `delivery-promise`: 560034 → grocery store uid 13845, "Delivery in 30 mins";
    110001 → electronics stores only, no grocery; 400053 → grocery store uid 3, "26 mins".
  - "toor dal": 103 hits at the Bengaluru store vs 135 at the Mumbai store; only 4 of the
    top 12 overlapped, and those 4 had identical prices.
  - robots.txt: www allows `/`; `api.jiomartjcp.com` has `Disallow: /`, which covers
    `delivery-promise`.
- Inferred: assortment and stock are per store; prices may be national. Location is
  enforced only by the store filter the client puts in the URL (omitting it was not
  tested).

### DMart Ready
- Observed:
  - Without a `storeId` header the search still returns 200 with prices — from an unknown
    default store.
  - 560034 → `storeId 10744` (home delivery on, pickup off). With `storeId: 10744`, 38 of
    40 shared SKUs had different prices (e.g. Healthy Choice Toor Dal 1 kg: ₹180 → ₹218).
  - At that store the only Amul Butter SKU was in `oosProducts` with `invStatus "0"`.
  - robots.txt: www disallows `/pdp/` and `*?storeId=`; `digital.dmart.in` has none (404).
- Inferred: a missing header silently prices another city — the same hazard as BigBasket.
  The adapter must always send `storeId` and refuse rows without it.

### Amazon
- Observed: no captcha in 8 requests. With no location, Fresh search returned 27 cards
  (e.g. Vedaka Toor Dal 1 kg ₹190, M.R.P. ₹300). After binding 560034 the page said "No
  results for your search query in Amazon Fresh"; at 560001, one unpriced sponsored card.
  No "Amazon Now" search surface found on the web. robots.txt allows `/s?k=`.
- Inferred: Fresh likely needs a precise address; location-less results don't describe a
  real delivery area. Out of scope for v1.

### Flipkart
- Observed: without a pincode, only the pincode popup. After serviceability returned `true`
  for 560034, "toor dal" gave 2 products, both `OUT_OF_STOCK`; "amul butter" gave
  `EMPTY_SEARCH`. Checking Minutes serviceability appeared to reset the grocery pincode.
  robots.txt disallows `/search?` for all agents. Flipkart Minutes redirected to a preview
  page at this pincode.
- Inferred: reachable but too thin to be useful. Out of scope for v1.

### Blinkit, Zepto, Instamart
- Blinkit: 403 with `cf-mitigated: challenge` and a ~247 KB error page on all three
  requests — now including robots.txt, which answered 200 on 2026-09-19.
- Zepto: search still gets the AWS WAF challenge (now a 0-byte body). Store lookup on
  `api.zepto.co.in` still returns 200 with the same Bengaluru store id.
- Instamart: `select-location/v2` still returns 200 (layoutId 4987, store 1396284);
  `search/v2` still gets the 202 WAF challenge.
- No change in outcome since 2026-09-19: all three need a browser-grade client.
