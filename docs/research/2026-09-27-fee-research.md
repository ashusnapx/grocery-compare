# Order-level fees on Indian grocery apps — 2026-09-27

Input to the fee catalog (see the design spec, "Fee model"). Fees are the most volatile
input in the app: they vary by city, dark store, time of day, demand, weather and even by
account.

**Sourcing.** Blinkit, Zepto, Instamart and Amazon block bots on their help pages, so
their numbers come from news, Swiggy's investor filings and dated user reports. BigBasket
and DMart figures were read from their live official pages on 2026-09-27.

**Legend.** C = confirmed (a 2025–26 source states it). U = uncertain (user report,
undated, search snippet only, or conflicting). ? = unknown. T = free-delivery threshold.
No source says whether T is measured before or after coupons, for any platform.

## Fee table

| Platform | Delivery fee / T | Hard MOV | Handling | Small-cart | Platform fee | Surge / rain / night | Membership | Time |
|---|---|---|---|---|---|---|---|---|
| Blinkit | ₹30 below ₹199 C[1]; T≈₹199 in most markets C[14]; cut in select Gurgaon/Bengaluru/Mumbai micro-markets, Jan 2026 C[13]; T=₹99 seen Jun 2026 U[11] | none; small carts pay fees U[1] | ₹4 C[1]; ₹5–9 U[11] | ₹20 below ₹99 C[12]; still seen Aug 2026 U[15] | ₹0 U[11] | rain surge applied to the whole pincode C[16], amount ?; late-night ? | none found C[4] | ~10 min C[18] |
| Zepto | T=₹199, up to ₹299 at peak, varies by pincode (Aug 2026) C[3]; fee below T was ₹20 when T was ₹149 (Jan 2026) C[2]; current fee ? | none U[1] | waived Nov 2025–Jan 2026 C[1][2]; waivers since "pulled back" C[4]; ₹0–40 depending on account U[11] | dropped Nov 2025 C[1] (was charged below ₹100 C[6]) | ₹0 C[1] (was ₹2 C[6]) | waived Jan 2026 C[2]; was ₹15 after 11 pm C[6]; peak demand now raises T instead C[3] | Zepto Club ₹99/month, invite-only: T=₹99, 5% cashback in Zepto coins, priority delivery C[5]; Pass and Daily discontinued C[5] | ~10 min C[18] |
| Swiggy Instamart | ₹30 below ₹199 C[1]; "no fee above ₹299" campaign Oct 2025–~20 Jan 2026 C[7][8]; delivery-fee charging resumed C[8]; T≈₹199 C[14] (₹149 seen U[11]) | none U[1] | ₹9.8 C[1]; ₹5–12 since Feb 2026 U[9][10][11] | ₹15 below ₹99 C[1]; current ? | ₹0 U[11] | late-night ₹10 U[9]; surges used to throttle demand C[8]; festive handling ₹8.5–20 by location C[19] | Swiggy One: T=₹199, surge-exempt, handling still charged U[10]; price ? | ~10 min C[18] |
| BB Now | official: fee varies with order value, time of day and weather C[20]; T=₹199 else ₹30 (Apr 2026) U[23]; T≈₹199 C[14] | ? | ₹6–7 U[11] | allowed by T&C, amount ? C[21] | ₹0 U[11] | surge allowed by T&C, amount ? C[21] | ? | ≤30 min U[20] |
| BigBasket slotted | below ₹600: ₹50; ₹600–1,000: ₹10 (₹15 Mumbai); above ₹1,000: free. Lucknow, Patna and 23 tier-2 cities: below ₹250 ₹60, then ₹30 up to ₹1,000 (₹1,200 Lucknow/Patna) C[20] | ? | ? | n/a (tiers) | ? | none found | bbstar ₹299 / 6 months: free delivery above ₹600, priority slots U[22] | morning/evening slots C[20] |
| Flipkart Minutes | T=₹99 on the standalone app (Delhi NCR only, Sep 2026) C[25]; some accounts charged ₹30 below ₹999 U[11] | ? | ₹0 U[11] | none found | ₹0 C[25] | none on orders ≥₹99 (Nov 2025) U[24] | Flipkart Black ₹990/yr: 5% SuperCoins, capped at 100; no fee waiver found U[26] | ? |
| Amazon Now | Prime: T=₹99, "zero fees" (Jul 2026) C[27]; ₹30 below ₹99, non-Prime T=₹199 U[29] | ? | none for Prime U[29] | none found | exempt from ₹5 marketplace fee C[28] | none found | Prime ₹1,499/yr, Lite ₹799, Shopping Edition ₹399 C[27]; which tiers qualify ? | "in minutes" C[27] |
| Amazon Fresh | Prime T=₹300; non-Prime ₹59 below ₹799 U[31] | non-Prime ₹300 U[31] | ? | ? | exempt C[28] | ? | Prime | 4–24 h; being shut in 10–15 cities (Apr 2026) C[30] |
| JioMart | Quick: ₹30 below ₹400, scheduled free (Jun 2026) U[11]; Sep 2025: ₹30 below ₹200, later T=₹100 U[33]; first 3 orders free U[34] | ? | none found U[11] | none found | none found | none found | none found | Quick ~30 min C[32] |
| DMart Ready | home delivery flat ₹49 at any order value; pickup point free C[35]; free delivery on a follow-up order from ₹299 (reward) C[35] | yes, lower for the first 3 orders; amount ? C[35] | none C[35] | — | — | — | none found | slots, target within 6 h, 11 cities C[36] |

**What varies**
- By city or dark store: [20][13][16][3][19].
- By time or demand: Zepto's peak threshold [3], BB Now time of day and weather [20],
  late-night fees [6][9], Swiggy surges [8], dated no-fee campaigns [7][24].
- By user: Prime vs non-Prime [27][29]; BigBasket shows T=₹99 to dormant accounts and ₹149
  or ₹199 to others [23]; Zepto's handling fee differs by account [11]; JioMart and DMart
  give perks on the first 3 orders [34][35].

## Fee rule shapes (the basis of the data model)

1. **Flat per order** — handling ₹4–12, platform fee ₹0–5, DMart delivery ₹49. Charged on
   every sub-order.
2. **One-step threshold** — fee F (₹20–30) when cart < T (T from ₹99 to ₹400), else 0.
3. **Multi-tier table keyed by city** — BigBasket slotted: ₹50 / ₹10 / ₹0, with different
   breakpoints in tier-2 cities.
4. **Second, lower step** — a small-cart fee of ₹15–20 below ~₹99, stacked on the delivery
   fee: two breakpoints.
5. **Context-dependent parameters** — demand (Zepto T ₹199 → ₹299 at peak), time and weather
   (BB Now), whole-pincode rain surge, late-night windows, festive fees, dated campaign
   overrides.
6. **Membership modifiers** — lower T (Prime ₹99 vs ₹199; Zepto Club ₹99); waivers of named
   fee types only (Swiggy One waives delivery and surge, not handling); capped cashback
   (a post-payment rebate, not a fee).
7. **Cohort and A/B overrides** — different thresholds for dormant or new users, perks on
   the first N orders, per-account handling fees.
8. **Mode and item conditions** — pickup vs home delivery (DMart), quick vs scheduled
   (JioMart), item-type fees such as tobacco convenience fees [2][21].
9. **Tax** — delivery fees carry 18% GST since 22 Sep 2025 [37]. Store fees as displayed,
   GST-inclusive (e.g. ₹9.8).

## Rules that interact with splitting

- **Per-order fees duplicate.** Each Blinkit sub-order under ₹99 pays about ₹54 (₹30
  delivery + ₹20 small-cart + ₹4 handling) [1]. One order of ₹199+ pays about ₹4–9.
- **Thresholds fragment.** A ₹300 basket split ₹180/₹120 lands under ₹199 on both apps.
  Topping a sub-order up to T with items the user is buying anyway can win.
- **The best split can flip within the hour.** Zepto's peak T of ₹299 and rain surges can
  reverse the optimum; surges are per order, so a split pays them twice.
- **Fees differ per user.** Prime, Zepto Club or Swiggy One status and account cohort
  change the best split for the same cart.
- **Add-on windows break "one order = one set of fees".** Blinkit lets you add items while
  an order is being packed with no extra delivery fee [17] (users report no small-cart or
  rain fee either [15]); BigBasket slotted add-ons in the same slot carry no extra
  delivery charge [20]; DMart add-ons need no MOV (up to ₹1,999, same slot) [35].
- **Never split a DMart home order.** Its ₹49 fee doesn't depend on order value.

## Sources

1. Upstox, "Zepto scraps handling, surge fees; vs Instamart, Blinkit", 3 Nov 2025. https://upstox.com/news/business-news/latest-updates/zepto-scraps-all-handling-surge-fees-how-does-it-stack-up-against-instamart-and-blinkit/article-183964/
2. Curly Tales, "Zepto ends free delivery below ₹99", 9 Jan 2026. https://curlytales.com/india/trending/zepto-ends-free-delivery-below-check-minimum-order-value-to-avoid-delivery-charge/
3. Goodreturns, "Zepto MOV raised to ₹199", 20 Aug 2026. https://www.goodreturns.in/news/zepto-free-delivery-charges-increased-minimum-order-value-raised-to-rs-199-check-new-rule-for-smal-1529635.html
4. Inc42, "Zepto's retention play… paid club", 1 Sep 2026. https://inc42.com/features/zeptos-retention-play-fewer-discounts-premium-carts-a-paid-club/
5. Storyboard18, "Zepto brings back subscriptions (Club)", 17 Jul 2026. https://www.storyboard18.com/amp/brand-marketing/zepto-brings-back-subscriptions-with-invite-only-club-membership-heres-what-it-includes-104603.htm
6. The Weekend Leader, "Zepto's hidden fees", 4 Jun 2025. https://www.theweekendleader.com/Headlines/80313/zeptos-hidden-fees-shock-customers-as-charges-creep-up.html
7. Swiggy, Q3 FY26 shareholder letter, Jan 2026. https://www.swiggy.com/corporate/wp-content/uploads/2026/01/Q3-FY2026-Shareholder-letter.pdf
8. Swiggy, Q4 FY26 call transcript (8 May 2026) and letter. https://www.swiggy.com/corporate/wp-content/uploads/2026/05/earnings-call-transcript-Q4-2026.pdf and https://www.swiggy.com/corporate/wp-content/uploads/2026/05/Q4-FY2026-Shareholder-letter.pdf
9. DesiDime user thread, "Swiggy again charging handling fee", 1 Feb 2026. https://www.desidime.com/discussions/swiggy-again-started-charging-handling-fee-for-instamart-orders
10. Lapaas Voice, "Swiggy brings back handling fees on Instamart", ~Feb 2026 (removed; read via search snippet). https://voice.lapaas.com/swiggy-brings-back-handling-fees-on-instamart/
11. DesiDime user thread, "JioMart: delivery charges" (users' fee snapshot across apps), 4–8 Jun 2026. https://www.desidime.com/discussions/jiomart-delivery-charges-f4b73b90-bbb9-441a-ba9c-c7bd28240b03
12. Inc42, "India's convenience economy is getting expensive", 31 Mar 2026. https://inc42.com/features/indias-convenience-economy-is-getting-expensive/
13. Outlook Business, "Blinkit drops delivery charges in select markets", 17 Jan 2026. https://www.outlookbusiness.com/start-up/e-commerce/blinkit-drops-delivery-charges-in-select-markets-as-q-commerce-race-heats-up
14. ANI via Punjab Kesari, "Q-commerce pricing discipline: Jefferies", 25 Sep 2026. https://english.punjabkesari.com/business/quick-commerce-sector-shows-signs-of-pricing-discipline-as-discounting-moderates-jefferies
15. DesiDime user thread, "Blinkit trick: small cart fees and rain surcharges", 2 Aug 2026. https://www.desidime.com/discussions/handy-blinkit-trick-to-save-2145519
16. Blinkit (@letsblinkit) on X, reply on rain surge, 6 May 2025. https://twitter.com/letsblinkit/status/1919664027325890902
17. Business Standard, "Blinkit 'add items after ordering'", 3 Dec 2025 (read via search result). https://www.business-standard.com/companies/news/companies-blinkit-add-items-after-order-feature-no-extra-delivery-charge-125120300527_1.html
18. Reuters via ESM Magazine, "India reins in '10-minute' claim", 19 Jan 2026. https://www.esmmagazine.com/technology/india-reins-in-booming-quick-commerce-sector-over-10-minute-delivery-claim-304228
19. Inc42, "Instamart festive handling fee (Holi)", 12 Mar 2025. https://inc42.com/buzz/swiggy-instamart-introduces-festive-handling-fee-for-holi-week/
20. BigBasket (official), delivery-charge FAQ and bbnow page, fetched 27 Sep 2026. https://www.bigbasket.com/delivery-charge/ and https://www.bigbasket.com/bbnow/
21. BigBasket (official), Terms & Conditions §4.1 and §7.8, fetched 27 Sep 2026. https://www.bigbasket.com/terms-and-conditions/
22. BigBasket (official), bbstar page, undated. https://www.bigbasket.com/bbstar/
23. DesiDime user thread, "BigBasket MOV ₹99→₹199", 24 Apr 2026. https://www.desidime.com/discussions/bigbasket-increased-mov-from-99-to-199-for-free-delivery
24. X posts: @dealztrendz, 14 Nov 2025, https://x.com/dealztrendz/status/1989195824270831767 and @CreditCardsInd, 5 Nov 2025, https://x.com/CreditCardsInd/status/1986115415123370018
25. Inc42, "Flipkart standalone Minutes app", 9 Sep 2026. https://inc42.com/buzz/flipkart-debuts-standalone-app-for-quick-commerce-platform-minutes/
26. DesiDime news, "Flipkart Black ₹299 for 3 months", ~May 2026. https://www.desidime.com/news/flipkart-black-at-299-for-3-months-till-8th-may-2026
27. About Amazon India, "Prime Day 2026" and "Prime benefits", Jul 2026. https://www.aboutamazon.in/news/amazon-prime/prime-day-2026-fastest-ever and https://www.aboutamazon.in/news/retail/heres-everything-you-need-to-know-about-your-amazon-prime-membership
28. About Amazon India, "Marketplace fees", Jun 2025. https://www.aboutamazon.in/news/company-news/amazon-introduces-marketplace-fee-on-orders
29. YourStory, Amazon Now reports, Jun and Jul 2025 (read via search snippets). https://yourstory.com/2025/06/amazon-launches-marketplace-fee-excludes-q-com-offering and https://yourstory.com/2025/07/amazon-expands-quick-commerce-service-to-delhi
30. Asia Business Outlook, "Amazon winds down Fresh", 7 Apr 2026. https://www.asiabusinessoutlook.com/news/amazon-shifts-to-quick-commerce-winds-down-fresh-nwid-11680.html
31. Amazon.in Help, "Amazon Fresh deliveries", undated (read via search snippet). https://www.amazon.in/gp/help/customer/display.html?nodeId=G6K5JRE64PMCDR2Z
32. Inc42, "JioMart Quick in 1,000 cities", 18 Oct 2025. https://inc42.com/buzz/reliance-expands-quick-jiomart-deliveries-to-1000-cities/
33. DesiDime user thread, "JioMart removed ₹30 fee below ₹200", 30 Sep 2025. https://www.desidime.com/discussions/jiomart-removed-30-delivery-fee-on-quick-orders-below-200
34. Jio Help, JioMart delivery-charges FAQ, undated. https://www.jio.com/help/faq/jio-apps/jiomart/are-there-any-delivery-charges-on-the-orders-placed-on-jiomart/
35. DMart Ready (official), FAQs and checkout text, fetched 27 Sep 2026. https://www.dmart.in/service/faqs
36. RetailIntel (citing Financial Express), "DMart Ready retreats to 11 cities", 7 Sep 2026. https://retailintel.in/signal/dmart-ready-retreats-to-11-cities-as-quick-commerce-reshapes-8306e5d2
37. Angel One, "18% GST on delivery from 22 Sep", Sep 2025. https://www.angelone.in/news/market-updates/zomato-swiggy-and-other-e-commerce-platforms-to-face-18-percent-gst-effective-sep-22
