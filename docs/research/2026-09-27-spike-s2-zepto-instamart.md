# Spike S2 — Zepto and Instamart through the `browser` transport (2026-09-27)

**Question (spec, "Spikes"):** can the `browser` transport reach Zepto and Instamart
search at a set location? **Pass:** ≥ 9 of 10 priced searches per platform, and a
session that stays valid for at least ~10 minutes.

**Where it ran:** the developer's Mac (arm64, macOS 27) on residential broadband in
Bengaluru — **not the VPS** (see Caveats). Playwright 1.63, Chromium 153.0.8010.12
(build 1243), **headless**. Location: Koramangala, 12.9352, 77.6245 (560034); second
city Andheri West, Mumbai, 19.1364, 72.8296 (400053).

## Verdict

| | Zepto | Instamart |
|---|---|---|
| Priced searches, batch of 10 (4 at a time) | **10 / 10** (20 listings each) | **10 / 10** (20 listings each) |
| Same session re-tested after idle gaps | not measured¹ | not measured¹ |
| Headless | passes (with the UA fix below) | passes (with the UA fix below) |
| Headed (`BROWSER_HEADLESS=false`) | not tried¹ | not tried¹ |
| **S2 from a residential IP** | **PASS** | **PASS** |

¹ The agent running this spike stopped before these two checks. The AWS WAF token
cookie it was issued is set to expire in 4 days, so sessions should outlive the
10-minute bar, but that was not measured.

S2 as the spec words it ("from the VPS") is **not yet answered**: everything here ran
from a residential IP. Re-run `apps/fetcher` with `try.ts` on the VPS before relying
on it; if it fails there, the spec's fallback is S4.

## What the WAF did

- **Plain HTTP** (the probe, re-confirmed): `www.zepto.com`, `bff-gateway.zepto.com`
  and `www.swiggy.com/instamart` answer 202 + `x-amzn-waf-action: challenge`.
- **Chromium runs the challenge**: the 202 page loads AWS's `challenge.js`, which calls
  `…token.awswaf.com/…/inputs` and `…/mp_verify` (Zepto) or `…/verify` (Instamart),
  sets an `aws-waf-token` cookie (on `.zepto.com` / `.www.swiggy.com`, cookie expiry
  4 days) and reloads into the real site. No CAPTCHA was ever shown.
- **Playwright's default headless build is refused.** `chromium-headless-shell`
  announces itself (UA `HeadlessChrome/153`, client-hint brand `HeadlessChrome`,
  SwiftShader WebGL, 0 plugins, no `window.chrome`). Zepto's challenge still passed
  and issued a token — and the reload was then refused with a bare **429** from
  CloudFront, leaving the tab on `chrome-error://`.
- **What passes:** the full Chromium build in Chrome's new headless mode
  (`channel: 'chromium'`), whose only remaining tell is the UA string, plus a
  context-level UA override (`… Chrome/153.0.0.0 Safari/537.36`, which also reaches
  workers). Measured locally against a local echo server:

  | | UA | client-hint brands | WebGL | plugins | `window.chrome` |
  |---|---|---|---|---|---|
  | headless shell (Playwright default) | HeadlessChrome | HeadlessChrome, Chromium | SwiftShader | 0 | missing |
  | new headless | HeadlessChrome | Chromium | Apple GPU | 5 | present |
  | new headless + UA override (**used**) | Chrome | Chromium | Apple GPU | 5 | present |

  `navigator.webdriver` is false in all three (`--disable-blink-features=AutomationControlled`).
  Viewport 1440×789 with screen 1440×900, so the window never exceeds the screen.
  Nothing else is spoofed and no challenge is solved by anything but the page itself.

## Location and store

**Zepto.** The site's own location cookies (`latitude`, `longitude`, `user_position`,
exactly what its "Use my current location" flow writes) are set before the first page
load; the site's server then answers with a `serviceability` cookie (primary, secondary
and tertiary dark stores, ETA, city, store name). `resolveStore` asks the site's own
home-layout call, `GET bff-gateway…/lms/api/v2/get_page?latitude&longitude&page_type=HOME…`,
whose `storeServiceableResponse` and ETA header are the assignment *now*; the label comes
from the site's reverse geocoder (`/api/v1/user/customer/address/location` →
"Koramangala"). An unserviceable point (Kanha National Park, 22.3345, 80.6115) answers
`{"serviceable": false}` → `null`.

The primary store for the same point **rotated four times in about an hour**
(796c71f3…, 5ec071fd…, bf1b6356…, 7e5a1821…; ETAs 10–23 min). Every search row carries
the `storeId` it was priced at, and the adapter refuses a page with a row from a store
it did not ask for.

**Instamart.** From inside the page, the site's own location API
`POST /api/instamart/home/select-location/v2 {data:{lat,lng,…,clientId:"INSTAMART-APP"}}`
sets the `userLocation` cookie and returns the pods: Koramangala → pod 1396284 (layout
4987, "5 Mins"); Andheri West → pod 1398452. Then one reload, after which the site's own
empty-cart call carries **"FREE DELIVERY on orders above ₹199"** → `feeHints:
{freeDeliveryAbove: 199}` (in both cities). Without the reload the cart answers `data:
null`. Unserviceable → `communication.swiggyNotPresent = true` → `null`. Swiggy's site
names no area for a coordinate and loads no geocoder, so the Instamart label is `null`.

## Search

Both searches were learned by letting the site search once through its own search box
and recording its requests (`page.on('request'/'response')`).

**Zepto** — `POST bff-gateway.zepto.com/user-search-service/api/v3/search`, body
`{query, pageNumber:0, intentId, mode:"AUTOSUGGEST", userSessionId}`, store in the
`store_id`/`store_ids`/`store_etas` headers. **Every bff-gateway call must be signed**:
without `request-signature` and `x-timezone`, CloudFront answers 429 with no CORS
headers (the page sees only "Failed to fetch"; the status is only visible through CDP).
The web client computes them in an axios request interceptor:
`request-signature = sha256(body|deviceId|method|requestId|secret|url)` (values in
sorted-key order), `secret` = the session's own `XSRF-TOKEN` cookie, and
`x-timezone = sha256(request-signature)`. A Node reimplementation reproduced **12 of 12**
signatures captured from the site's own requests (GET and POST), and signed searches
answer 200. Every input is issued to the anonymous browser session; no account or
credential is involved. This is the most fragile part of either adapter (see Caveats).

**Instamart** — `POST /api/instamart/search/v2?offset=0&ageConsent=false&layoutId=…&
voiceSearchTrackingId=&storeId=…&primaryStoreId=…&secondaryStoreId=` with body
`{facets:[], sortAttribute:"", query, search_results_offset:"0",
page_type:"INSTAMART_AUTO_SUGGEST_PAGE", is_pre_search_tag:false}`. The site also sends
`x-build-version`, `x-device-id` and an obfuscated `matcher` header; the search answers
200 without any of them today. The adapter sends the first two, not `matcher`.

**Prices.** Zepto money is **paise**: the page showed Milky Mist Table Butter at ₹73
(MRP ₹85) for `discountedSellingPrice: 7300, mrp: 8500`. Instamart money is
`{units, nanos}` in **rupees**: "SOLD OUT · Amul Pasteurised Butter · 100 g x 4 · ₹252"
was `offerPrice.units: "252"`, `inventory.inStock: false`.

**PDP links**, read off the sites' own cards: Zepto
`https://www.zepto.com/pn/<name-slug>/pvid/<productVariant.id>`; Instamart
`https://www.swiggy.com/instamart/item/<productId>`.

## Results

Batch of 10 in Koramangala, one session per platform, 4 searches at a time (as
`search.ts` runs them):

| Query | Zepto listings (in stock) · ms | Instamart listings (in stock) · ms |
|---|---|---|
| atta | 20 (20) · 758 | 20 (19) · 692 |
| basmati rice | 20 (20) · 768 | 20 (20) · 696 |
| sunflower oil | 20 (20) · 614 | 20 (20) · 563 |
| sugar | 20 (20) · 787 | 20 (19) · 635 |
| milk | 20 (20) · 314 | 20 (20) · 500 |
| eggs | 20 (20) · 467 | 20 (20) · 489 |
| bread | 20 (20) · 439 | 20 (20) · 514 |
| tomato | 20 (20) · 241 | 20 (17) · 516 |
| maggi | 20 (20) · 415 | 20 (20) · 470 |
| tea | 20 (20) · 389 | 20 (20) · 522 |
| **whole batch** | **1.4 s** | **1.7 s** |

**Latency.** Cold session (browser launch + challenge + location + store): Zepto
5.2–6.5 s, Instamart 4.9–5.1 s (Instamart includes the location reload). Warm search:
Zepto 240–790 ms, Instamart 470–700 ms. A cold 3-query comparison through `try.ts`:
Zepto 5.9 s, Instamart 9.6 s. Cold sessions fit inside the 15 s per-platform deadline,
but they are most of the latency budget: a warm session is what makes "first results in
5 s" possible.

Three real Bengaluru listings each (Koramangala, 2026-09-27 ~16:00 IST):

| Platform | Title | quantityText | Price | MRP |
|---|---|---|---|---|
| Zepto | Tata Sampann Unpolished Toor Dal \| Arhar Dal | 1 pack (500 g) | ₹86 | ₹118 |
| Zepto | Onion | 900 g - 1 kg | ₹66 | ₹127 |
| Zepto | Milky Mist Table Butter | 1 pack (100 g) | ₹73 | ₹85 |
| Instamart | Tata Sampann Unpolished Toor Dal (Arhar Dal) | 500 g | ₹89 | ₹118 |
| Instamart | Onion (Eerulli) | 1 kg | ₹71 | ₹89 |
| Instamart | Amul Pasteurised Butter (sold out) | 100 g x 4 | ₹252 | ₹252 |

**Mumbai (Andheri West).** Zepto → store 8be2198a…, "Oshiwara", "9 minutes"; Instamart
→ pod 1398452, "5 Mins", free delivery above ₹199. Both 3/3 priced. Prices differ by
city: Zepto onion ₹60 (₹66 in Bengaluru), Tata Sampann toor dal 500 g ₹102 (₹86);
Instamart onion 1 kg ₹67 (₹71).

## Session lifetime

LIFETIME_SECTION

## Rate limiting seen

Instamart once answered **HTTP 200 with `{"statusCode": 429}`** to three concurrent
searches, right after ~10 `select-location` calls in two minutes during discovery. It
had cleared two minutes later, and later bursts of three concurrent searches passed.
The adapter treats an in-body 429 as a rate limit: one 1.5 s back-off and retry, then
`blocked` — and it does **not** recycle the session for it (a fresh session would only
dodge the limit). Zepto never rate-limited a signed search.

## Caveats

1. **Residential IP, not a VPS.** AWS WAF weighs IP reputation, and datacenter ranges
   are challenged harder (CAPTCHA instead of a silent challenge is possible). This pass
   says nothing about the VPS; re-run there. A CAPTCHA would surface as `blocked` and
   the spec's answer is S4, not a solver.
2. **Zepto's request signature is replicated client logic.** If Zepto changes the
   scheme, searches become `blocked` ("refused before any response") until
   `signRequest()` is re-derived from the site's JS (search it for
   `request-signature`). It also means the Zepto adapter reproduces an integrity
   mechanism of the site, which weighs on the Terms-of-Service risk the spec already
   accepts; the rest of the approach only ever lets the page run the site's own code.
3. **Store rotation.** Zepto reassigns a point between dark stores within minutes.
   Rows are real prices of the store named, but a user opening the app a few minutes
   later may be served by another store. The fetcher's 10-minute store cache for Zepto
   and Instamart bounds this.
4. **Detection can escalate.** Today one UA string is the only difference that matters.
   If either site starts checking automation signals (CDP artefacts and the like),
   headless will fail first; `BROWSER_HEADLESS=false` (headed, under Xvfb on a server)
   is the next step to try, before S4.
5. **Anonymous prices.** Member prices (Zepto Pass, Swiggy One) are ignored; `price` is
   what a logged-out visitor is shown.
6. **Memory.** Each session is a browser context + page, ~150–250 MB on these sites;
   `BROWSER_MAX_SESSIONS` (default 6) caps the pool and idle sessions close after
   15 min. On a 2 GB VPS, 4 is safer.

## Politeness

The whole task made about POLITE_ZEPTO Zepto searches and POLITE_INSTAMART Instamart
searches (discovery, adapter runs, this spike), a few dozen page loads and ~15
`select-location` calls — page 1 only, no enumeration, no logins, no proxies, no
CAPTCHA solving.

## Where this lives

- `apps/fetcher/src/transports/browser.ts` — the pool: launch, UA, sessions (TTL 30 min,
  idle 15 min, LRU cap), per-page concurrency, `openThroughChallenge`, `withSession`
  (recycle once on a challenge or a dead page, never on a rate limit), `pageFetch`
  (native fetch, in-page timeout).
- `apps/fetcher/src/adapters/zepto.ts`, `instamart.ts` — adapters, with the
  VERIFIED/ASSUMPTIONS header each.
- `apps/fetcher/src/adapters/{zepto,instamart}.test.ts` and
  `apps/fetcher/test/fixtures/{zepto,instamart}/` — offline parser tests on trimmed
  captures from this spike.
