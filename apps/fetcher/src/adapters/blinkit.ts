/**
 * Blinkit — https://blinkit.com — transport: `impersonate` (impit, chrome151)
 *
 * ---------------------------------------------------------------------------
 * VERIFICATION LOG — probed live 2026-09-27 from one Indian residential IP in
 * Bengaluru. Spike note with every status code and header:
 * docs/research/2026-09-27-spike-s1-blinkit.md. READ THIS BEFORE TRUSTING A ROW.
 *
 * VERIFIED LIVE (2026-09-27):
 *  - Transport. Cloudflare fronts every path. Node fetch / curl get 403
 *    `cf-mitigated: challenge` everywhere (platform probe). impit with the
 *    `chrome151` fingerprint got 200 on the homepage, the ETA API and the
 *    search API: 10 of 10 searches in the S1 run returned priced JSON in
 *    312–625 ms, with no cookie from an earlier page and no auth_key. impit's
 *    generic `chrome` profile (the transport's default) was challenged on the
 *    homepage HTML, so this adapter pins IMPIT_BROWSER. Headless Playwright
 *    Chromium was challenged ("Just a moment…") on every HTML page and had not
 *    cleared it after 4–6 s, so `browser` is the worse transport here, not the
 *    fallback.
 *  - Search is `POST /v1/layout/search?q=<term>&search_type=type_to_search`
 *    with a `{}` body. A GET to the same path gets the origin's own
 *    "404 page not found" (Cloudflare let it through; the route is POST-only).
 *  - Location travels in the `lat` / `lon` REQUEST HEADERS. With headers
 *    saying Mumbai and gr_1_lat/gr_1_lon cookies saying Bengaluru, the answer
 *    was Mumbai's, so the headers win. We send both, always equal, as the web
 *    client does.
 *  - Store lookup is `GET /v1/consumerweb/eta` with the same headers. It
 *    returns `eta_in_minutes` (13), `title` ("Delivery in 13 minutes"),
 *    `update_eta_action.update_eta.merchant_info.id` (the express dark store:
 *    40076 for Koramangala, 560034) and `eta_map_v2`, keyed by every merchant
 *    that serves the point (express, longtail, super_longtail, pharmacy …).
 *    An unserviceable point (Kavaratti, Lakshadweep) returns 200 with
 *    `status_code: "Non Serviceable"` and no merchant.
 *  - The serving merchant is DYNAMIC. For the same Andheri West point (19.1364,
 *    72.8296) the express store was 33684 at 15:41 IST and 47074 at 15:44 IST,
 *    with identical requests, and search agreed with the later answer. So a
 *    store cached for 24 h can go stale. The location check below re-resolves
 *    once before it refuses anything.
 *  - Search cards carry `merchant_id` / `merchant_type`. In 11 responses, every
 *    card came from a merchant listed in that point's `eta_map_v2` at the time.
 *    That is the only location evidence a search response carries: there is no
 *    lat/lon, city or locality echo anywhere in it.
 *  - `atc_action.add_to_cart.cart_item.price` / `.mrp` are integer RUPEES. On
 *    223 of 223 cards (variants included) the price equals the "₹" display text
 *    in `normal_price.text`.
 *  - Stock: out-of-stock variants had `product_state: "out_of_stock"` and
 *    `inventory: 0` while `is_sold_out` stayed false. is_sold_out alone lies.
 *  - `variant_list` on a card holds the line's other pack sizes. Each is a
 *    full card with its own id, price, stock and merchant (2 of 91 had a
 *    different merchant from their parent).
 *  - Page shape: a "Showing results for "<q>"" header, 12 product cards mixed
 *    with filter / carousel / "Similar brands" widgets, then sometimes a
 *    "Showing related products" header followed by padding (tomatoes for
 *    "onion"). A query with no results returns is_success true, a single
 *    separator snippet and no product card.
 *  - `tracking.common_attributes.ptype` is Blinkit's product type ("Toor Dal",
 *    "Salted Butter"). l0/l1/l2 categories were empty on every card.
 *  - Product URLs are `/prn/<slug>/prid/<id>`. slugify() on the card name gave
 *    the page's own canonical URL for prid 39493, and a non-canonical slug for
 *    prid 442163 still returned 200. The prid resolves the product; the slug is
 *    cosmetic.
 *  - All 40 distinct `variant` texts seen ("500 g", "2 x 1 kg", "24 pcs",
 *    "1 ltr" …) parse with the engine's parseQuantityText.
 *
 * FEES — VERIFIED LIVE 2026-09-29, logged out, Koramangala and Andheri West
 * (docs/research/2026-09-29-live-fees.md):
 *  - The ETA answer carries no fee facts. The guest cart does: `POST
 *    /v5/carts` with `{"items":[]}` — the web client's own CART_POST, sent
 *    with `qd_sdk_request: true` like its FETCH_CART — answers 200 without
 *    login and creates nothing (cart id 0). resolveStore makes this one extra
 *    call, concurrently with the ETA call.
 *  - `cart_data.bill_details.flat_delivery_charge_attributes` is the delivery
 *    rule: `graded_delivery_charge_constructs` [0–99) ₹25, [99–1000) ₹0, with
 *    `flat_delivery_charge` 25 and `free_delivery_mov` 99 agreeing. A ₹21 cart
 *    at the same point rendered exactly that as its bill tooltip ("₹25 for
 *    orders below ₹99", "₹0 for orders above ₹99"). `bill_details.
 *    free_delivery_mov` one level up is NOT this threshold (800 empty, 250 with
 *    one item) and is not read.
 *  - Handling: `page_meta.custom_data.platform_charges_data` names each charge
 *    family (handling, small_cart, delivery, night, convenience) with the
 *    assignment tag in force, `{}` when none is. The handling family's tag
 *    ("mov|hc_2") is the one `cart_data.additional_charges[]` entry with the
 *    same tag: ₹2, charge_id 3, flat from ₹0. The ₹21 bill showed "Handling
 *    charge ₹2" (charge 3, "eco_friendly_packaging_cost").
 *  - Small cart: `small_cart_charge` was `{}` and the ₹21 bill had no
 *    small-cart line, although `surge_charge_v2` of the item cart carried
 *    `small_cart_fee` 15 / `small_cart_mov` 99 (store config for surges; not
 *    charged). So "none in force" is read only when the family is `{}` AND
 *    `surge_charge_v2.source` is "no_surge"; anything else leaves the catalog.
 *  - Surge: `surge_charge_v2` {surge_amount 0, source "no_surge", type FLAT,
 *    mov 0, checkouts_block_mov 0} in both cities. A positive surge_amount
 *    with mov 0 is read as surgeFee; checkouts_block_mov > 0 as minOrder.
 *    Neither was observed live (no rain that morning).
 *
 * ASSUMED (fees):
 *  - Assignment tags are A/B cohorts ("assignment_type: control") keyed to
 *    the device; ours is random per process, so another device may be quoted
 *    other fees. Logged-in accounts may differ too.
 *  - That an empty cart's surge block reflects a surge in force. A surge that
 *    only shows on a non-empty cart would be missed (the catalog has no
 *    Blinkit surge either).
 *
 * ASSUMED (not verified):
 *  - That a `{}` body stays acceptable. The web client's own body was never
 *    observed, because headless Chromium never got past the challenge to
 *    search.
 *  - That page 1 (12 cards) is enough. `response.pagination.next_url` is
 *    ignored on purpose: this is a price lookup, not a crawl.
 *  - That this works from a datacenter IP. Everything above came from one
 *    residential IP, and Cloudflare scores datacenter ranges differently.
 *    Re-run S1 from the VPS before relying on it.
 *  - That chrome151 keeps passing as real Chrome versions move on.
 *  - That `eta_map_v2` lists every merchant a search can price from. If
 *    Blinkit adds a merchant type the ETA map omits, searches fail loudly with
 *    UpstreamError. They do not fail silently.
 *
 * WHEN THIS BREAKS, CHECK IN THIS ORDER:
 *   1. `blocked`: Cloudflare now challenges the fingerprint. Try a newer impit
 *      profile in IMPIT_BROWSER, then re-run S1. A 200 carrying HTML is
 *      reported as blocked too (assertJsonBody).
 *   2. UpstreamError "HTTP 404": the search route or method moved. Open
 *      blinkit.com/s/?q=milk in a real browser, watch the network tab, and
 *      re-point SEARCH_PATH / SEARCH_METHOD.
 *   3. "none could be priced": a field path in FIELD changed. Diff one live
 *      card against the fixtures in apps/fetcher/test/fixtures/blinkit/.
 *   4. "another location" errors: compare the merchants the error names with
 *      a fresh GET of ETA_PATH for the same lat/lon.
 *   5. Fees fall back to the catalog ("fee lookup failed" / "stated no fee" in
 *      the log): add one item to a cart on blinkit.com logged out, compare the
 *      bill with the CART paths against test/fixtures/blinkit/cart-*.json.
 * ---------------------------------------------------------------------------
 */

import { randomBytes } from 'node:crypto';
import type { FeeHints, GeoLocation, Listing } from '@gc/engine';
import type { Impit } from 'impit';
import { UpstreamError } from '../errors';
import { createImpersonator, impersonateJson } from '../transports/impersonate';
import type { AdapterContext, PlatformAdapter, ResolvedStore } from './types';

// --- Endpoints --------------------------------------------------------------

const ORIGIN = 'https://blinkit.com';
const HOST = 'blinkit.com';

/**
 * impit fingerprint. The transport default (`chrome`) was challenged on the
 * homepage on 2026-09-27; `chrome151` was not.
 */
const IMPIT_BROWSER = 'chrome151';

const SEARCH_PATH = '/v1/layout/search';
/** The route answers GET with 404; POST is the verified method. */
const SEARCH_METHOD = 'POST';
/** Verified to work. The web client's real body is unobserved (see ASSUMED). */
const SEARCH_BODY = '{}';
const PARAM_QUERY = 'q';
const PARAM_SEARCH_TYPE = 'search_type';
/** What the site's own search box sends (its redux default `searchType`). */
const SEARCH_TYPE = 'type_to_search';
/** Where a person would be standing when their browser made this call. */
const SEARCH_PAGE_PATH = '/s/';

/** Serviceability, serving merchants and delivery ETA for the lat/lon headers. */
const ETA_PATH = '/v1/consumerweb/eta';

/**
 * The guest cart (the web client's CART_POST). Posted empty it states the fee
 * rules in force for the lat/lon headers; see FEES in the log above.
 */
const CART_PATH = '/v5/carts';
const CART_BODY = JSON.stringify({ items: [] });
/** What the web client adds to its own cart call (FETCH_CART). */
const CART_HEADERS: Readonly<Record<string, string>> = { qd_sdk_request: 'true' };

/** Well inside the 15 s per-platform deadline. Observed calls take 0.3–0.6 s. */
const REQUEST_TIMEOUT_MS = 8000;
/** Fees are a nicety on top of the store; a slow cart must not hold the store lookup long. */
const FEE_TIMEOUT_MS = 4000;

// --- Request identity -------------------------------------------------------
// Values the web client itself sends (window.grofers.CONFIG and fetchAction in
// its bundle, 2026-09-27). None of them is a credential.

const HEADER_LAT = 'lat';
const HEADER_LON = 'lon';
/** `config.cookieVersion` is "gr_1". The API reads the headers; cookies ride along. */
const COOKIE_LAT = 'gr_1_lat';
const COOKIE_LON = 'gr_1_lon';

const CLIENT_HEADERS: Readonly<Record<string, string>> = {
  app_client: 'consumer_web',
  app_version: '52434332',
  /** convertVersionToInt("8.10.16") in their bundle. */
  web_app_version: '1008010016',
  platform: 'desktop_web',
};

/**
 * What Chrome sends for a same-origin `fetch()`. impit's Chrome profile
 * defaults to navigation headers, and an empty string removes one.
 */
const FETCH_HEADERS: Readonly<Record<string, string>> = {
  accept: '*/*',
  'accept-language': 'en-IN,en;q=0.9',
  'content-type': 'application/json',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'sec-fetch-user': '',
  'upgrade-insecure-requests': '',
  priority: 'u=1, i',
};

/** Their client makes 8 random bytes, hex-encoded, once per browser. Ours is once per process. */
const DEVICE_ID = randomBytes(8).toString('hex');

// --- Response shape ---------------------------------------------------------

const PRODUCT_CARD_PREFIX = 'product_card_snippet_type_';
const HEADER_WIDGET = 'image_text_vr_type_header';
/** "Showing related products": everything after it is padding, not a match. */
const RELATED_SECTION_RE = /\brelated products\b/i;
/** The only product_state that means "you can add this to a cart now". */
const AVAILABLE_STATE = 'available';
/** `status_code` of an ETA answer for a point Blinkit does not deliver to. */
const UNSERVICEABLE_STATUS_RE = /^non[\s_-]?serviceable$/i;
/** The display price and the cart price agreed exactly on every card seen. */
const PRICE_TOLERANCE_RUPEES = 1;
/** Anything beyond a day is a parse artefact, not a quick-commerce promise. */
const MAX_ETA_MINUTES = 24 * 60;

/**
 * Page 1 holds 12 products. Their other pack sizes (variant_list) come after
 * all 12, so no page-1 product is ever cut in favour of a pack size.
 */
const MAX_LISTINGS = 24;

/** Every field path read, relative to the object named in each group. */
const FIELD = {
  // search envelope
  success: ['is_success'],
  snippets: ['response', 'snippets'],
  // on a snippet, or on a variant_list item (same shape)
  widgetType: ['widget_type'],
  data: ['data'],
  headerText: ['data', 'title', 'text'],
  category: ['tracking', 'common_attributes', 'ptype'],
  // on snippet.data
  id: ['identity', 'id'],
  name: ['name', 'text'],
  brand: ['brand_name', 'text'],
  variant: ['variant', 'text'],
  displayPrice: ['normal_price', 'text'],
  displayMrp: ['mrp', 'text'],
  merchantId: ['merchant_id'],
  productState: ['product_state'],
  soldOut: ['is_sold_out'],
  inventory: ['inventory'],
  image: ['image', 'url'],
  variants: ['variant_list'],
  cartItem: ['atc_action', 'add_to_cart', 'cart_item'],
  // on cart_item
  cartPrice: ['price'],
  cartMrp: ['mrp'],
  cartProductId: ['product_id'],
  cartName: ['product_name'],
  cartUnit: ['unit'],
  cartMerchantId: ['merchant_id'],
  cartInventory: ['inventory'],
  cartImage: ['image_url'],
  // ETA response
  etaMinutes: ['eta_in_minutes'],
  etaTitle: ['title'],
  etaStatus: ['status_code'],
  etaMerchant: ['update_eta_action', 'update_eta', 'merchant_info', 'id'],
  etaMerchantMap: ['update_eta_action', 'update_eta', 'eta_map_v2'],
} as const;

/** Field paths in the guest cart answer (POST CART_PATH), relative to the object named. */
const CART = {
  // on the answer
  data: ['cart_data'],
  deliveryRule: ['cart_data', 'bill_details', 'flat_delivery_charge_attributes'],
  surge: ['cart_data', 'bill_details', 'surge_charge_v2'],
  charges: ['cart_data', 'additional_charges'],
  families: ['page_meta', 'custom_data', 'platform_charges_data'],
  // on deliveryRule
  tiers: ['graded_delivery_charge_constructs'],
  flatCharge: ['flat_delivery_charge'],
  freeAbove: ['free_delivery_mov'],
  // on one tier
  tierFrom: ['min_amount'],
  tierCharge: ['delivery_charge'],
  // on surge
  surgeAmount: ['surge_amount'],
  surgeSource: ['source'],
  surgeMov: ['mov'],
  checkoutBlockMov: ['checkouts_block_mov'],
  // on one additional charge, and on one of its variations
  chargeAmount: ['amount'],
  chargeTag: ['meta', 'assignment_info', 'assignment_tag'],
  chargeVariations: ['meta', 'variation'],
  variationAmount: ['amount'],
  // on one charge family
  familyTag: ['assignment_tag'],
} as const;
const HANDLING_FAMILY = 'handling_charge';
const SMALL_CART_FAMILY = 'small_cart_charge';
/** `surge_charge_v2.source` when no surge is in force. */
const NO_SURGE = 'no_surge';

// --- Product URL ------------------------------------------------------------

const PRODUCT_PATH_PREFIX = 'prn';
const PRODUCT_ID_SEGMENT = 'prid';
/** Blinkit cuts its own slugs here (med-compare matched 7 of 7 archived slugs). */
const SLUG_MAX_LENGTH = 48;

// --- Small readers ----------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(value: unknown, path: readonly string[]): unknown {
  let cur = value;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Ids are digit strings on the card and numbers on the cart item. */
function idOf(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  const text = textOf(value);
  return text !== null && /^\d+$/.test(text) ? text : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** "₹1,299" → 1299. Text without a rupee sign is not treated as a price. */
export function rupeesOf(text: string | null): number | null {
  if (text === null) return null;
  const match = /(?:₹|rs\.?)\s*(\d[\d,]*(?:\.\d+)?)/i.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/** Lowercase, punctuation dropped, whitespace hyphenated, cut at 48 characters. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug === '' ? 'p' : slug;
}

function httpsUrl(value: unknown): string | null {
  const text = textOf(value);
  if (text === null || !/^https?:\/\//i.test(text)) return null;
  return text.replace(/^http:\/\//i, 'https://');
}

// --- Search parsing (pure) --------------------------------------------------

export interface ParsedSearch {
  /** Results section only: page-1 products first, then their other pack sizes. */
  listings: Listing[];
  /** Distinct merchant ids the listings are priced at: the location evidence. */
  merchantIds: string[];
  /** Listings whose card carried no merchant id (so their location is unknown). */
  unlocated: number;
  /** Product cards in the results section that could not be priced and were dropped. */
  unpriced: number;
}

interface Row {
  listing: Listing;
  merchantId: string | null;
}

interface Inherited {
  brand: string | null;
  category: string | null;
}

/**
 * One product card (or variant_list item, which has the same shape) → one row,
 * or null when it is not a card we can price honestly.
 */
function toRow(item: unknown, fetchedAt: string, inherited: Inherited | null): Row | null {
  const data = at(item, FIELD.data);
  if (!isRecord(data)) return null;
  const cart = at(data, FIELD.cartItem);

  const listingId = idOf(at(data, FIELD.id)) ?? idOf(at(cart, FIELD.cartProductId));
  const title = textOf(at(data, FIELD.name)) ?? textOf(at(cart, FIELD.cartName));
  if (listingId === null || title === null) return null;

  // The cart number is what checkout charges. The "₹" string is the check on
  // our reading of it, and it catches a switch to paise, for example.
  const cartPrice = numberOf(at(cart, FIELD.cartPrice));
  const shownPrice = rupeesOf(textOf(at(data, FIELD.displayPrice)));
  if (cartPrice !== null && shownPrice !== null && Math.abs(cartPrice - shownPrice) > PRICE_TOLERANCE_RUPEES) {
    return null;
  }
  const price = cartPrice ?? shownPrice;
  if (price === null || price <= 0) return null;

  const rawMrp = numberOf(at(cart, FIELD.cartMrp)) ?? rupeesOf(textOf(at(data, FIELD.displayMrp)));
  // An MRP under the price would render as a negative saving.
  const mrp = rawMrp !== null && rawMrp >= price ? rawMrp : null;

  const state = at(data, FIELD.productState);
  const inventory = numberOf(at(data, FIELD.inventory)) ?? numberOf(at(cart, FIELD.cartInventory));
  const inStock =
    at(data, FIELD.soldOut) !== true &&
    (typeof state !== 'string' || state === AVAILABLE_STATE) &&
    (inventory === null || inventory > 0);

  return {
    merchantId: idOf(at(data, FIELD.merchantId)) ?? idOf(at(cart, FIELD.cartMerchantId)),
    listing: {
      platformId: 'blinkit',
      listingId,
      title,
      brand: textOf(at(data, FIELD.brand)) ?? inherited?.brand ?? null,
      // Blinkit's own pack text, untouched. Empty when the card states none.
      quantityText: textOf(at(data, FIELD.variant)) ?? textOf(at(cart, FIELD.cartUnit)) ?? '',
      price,
      mrp,
      inStock,
      productUrl: `${ORIGIN}/${PRODUCT_PATH_PREFIX}/${slugify(title)}/${PRODUCT_ID_SEGMENT}/${listingId}`,
      imageUrl: httpsUrl(at(data, FIELD.image)) ?? httpsUrl(at(cart, FIELD.cartImage)),
      category: textOf(at(item, FIELD.category)) ?? inherited?.category ?? null,
      fetchedAt,
    },
  };
}

function isProductCard(item: unknown): boolean {
  const type = at(item, FIELD.widgetType);
  return typeof type === 'string' && type.startsWith(PRODUCT_CARD_PREFIX);
}

function startsRelatedSection(item: unknown): boolean {
  if (at(item, FIELD.widgetType) !== HEADER_WIDGET) return false;
  const text = textOf(at(item, FIELD.headerText));
  return text !== null && RELATED_SECTION_RE.test(text);
}

/**
 * The body of `POST /v1/layout/search` → listings. Pure: no I/O and no clock
 * unless `fetchedAt` is omitted.
 *
 * Throws UpstreamError on shape drift, never returns [] for it. A missing
 * snippet array, is_success other than true, or product cards of which none
 * could be priced would otherwise read as "Blinkit doesn't sell this", a
 * claim we would not have earned.
 */
export function parseSearchResponse(json: unknown, fetchedAt: string = new Date().toISOString()): ParsedSearch {
  if (!isRecord(json)) throw new UpstreamError(`${HOST}: search response is not a JSON object`);
  const success = at(json, FIELD.success);
  if (success !== true) throw new UpstreamError(`${HOST}: search answered is_success=${String(success)}`);
  const snippets = at(json, FIELD.snippets);
  if (!Array.isArray(snippets)) throw new UpstreamError(`${HOST}: search response has no response.snippets array`);

  const primaries: Row[] = [];
  const packSizes: Row[] = [];
  let cards = 0;
  let unpriced = 0;

  for (const snippet of snippets) {
    if (startsRelatedSection(snippet)) break;
    if (!isProductCard(snippet)) continue;

    cards++;
    const row = toRow(snippet, fetchedAt, null);
    if (row) primaries.push(row);
    else unpriced++;

    const data = at(snippet, FIELD.data);
    const list = at(data, FIELD.variants);
    if (!Array.isArray(list)) continue;
    const parentId = idOf(at(data, FIELD.id));
    const inherited: Inherited = { brand: row?.listing.brand ?? null, category: row?.listing.category ?? null };
    for (const variant of list) {
      // variant_list repeats the card itself; it is the same product, not another size.
      if (parentId !== null && idOf(at(variant, [...FIELD.data, ...FIELD.id])) === parentId) continue;
      const vRow = toRow(variant, fetchedAt, inherited);
      if (vRow) packSizes.push(vRow);
      else unpriced++;
    }
  }

  if (cards > 0 && primaries.length === 0 && packSizes.length === 0) {
    throw new UpstreamError(`${HOST}: ${cards} product card(s) but none could be priced (field paths changed?)`);
  }

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const row of [...primaries, ...packSizes]) {
    if (rows.length >= MAX_LISTINGS) break;
    if (seen.has(row.listing.listingId)) continue;
    seen.add(row.listing.listingId);
    rows.push(row);
  }

  const merchants = new Set<string>();
  let unlocated = 0;
  for (const row of rows) {
    if (row.merchantId === null) unlocated++;
    else merchants.add(row.merchantId);
  }

  return { listings: rows.map((r) => r.listing), merchantIds: [...merchants], unlocated, unpriced };
}

// --- ETA / store parsing (pure) ---------------------------------------------

export type ParsedEta =
  | {
      serviceable: true;
      /** The express dark store Blinkit names for the point. */
      merchantId: string;
      /** Every merchant serving the point (eta_map_v2 keys), primary first. */
      merchantIds: string[];
      minutes: number | null;
      title: string | null;
    }
  | { serviceable: false; status: string };

/** The body of `GET /v1/consumerweb/eta` → serviceability, merchants, ETA. */
export function parseEtaResponse(json: unknown): ParsedEta {
  if (!isRecord(json)) throw new UpstreamError(`${HOST}: ETA response is not a JSON object`);

  const merchantId = idOf(at(json, FIELD.etaMerchant));
  const status = textOf(at(json, FIELD.etaStatus));

  if (merchantId === null) {
    if (status !== null && UNSERVICEABLE_STATUS_RE.test(status)) return { serviceable: false, status };
    throw new UpstreamError(
      `${HOST}: ETA response names no merchant and no "Non Serviceable" status (status_code: ${status ?? 'absent'})`,
    );
  }

  const map = at(json, FIELD.etaMerchantMap);
  const others = isRecord(map) ? Object.keys(map).filter((key) => idOf(key) !== null) : [];
  const minutes = numberOf(at(json, FIELD.etaMinutes));

  return {
    serviceable: true,
    merchantId,
    merchantIds: [...new Set([merchantId, ...others])],
    minutes: minutes !== null && minutes > 0 && minutes <= MAX_ETA_MINUTES ? Math.round(minutes) : null,
    title: textOf(at(json, FIELD.etaTitle)),
  };
}

// --- Fees (pure) ------------------------------------------------------------

/**
 * The delivery rule, when it is one paid step from ₹0 followed by free
 * delivery: the only shape FeeHints can carry. A tier table with two paid
 * steps, or one that disagrees with its own flat_delivery_charge /
 * free_delivery_mov, says nothing rather than something half right.
 */
function deliveryHints(rule: unknown): Pick<FeeHints, 'deliveryFee' | 'freeDeliveryAbove'> {
  if (!isRecord(rule)) return {};
  const flat = numberOf(at(rule, CART.flatCharge));
  const above = numberOf(at(rule, CART.freeAbove));
  const table = at(rule, CART.tiers);
  if (!Array.isArray(table) || table.length === 0) {
    return flat !== null && above !== null && flat >= 0 && above > 0 ? { deliveryFee: flat, freeDeliveryAbove: above } : {};
  }
  const tiers = table.map((t) => ({ from: numberOf(at(t, CART.tierFrom)), charge: numberOf(at(t, CART.tierCharge)) }));
  if (tiers.some((t) => t.from === null || t.charge === null || t.charge < 0)) return {};
  const sorted = (tiers as { from: number; charge: number }[]).sort((a, b) => a.from - b.from);
  const [first, ...rest] = sorted;
  if (first.from !== 0) return {};
  if (rest.some((t) => t.charge !== 0)) return {};
  if (first.charge === 0) return flat === null || flat === 0 ? { deliveryFee: 0 } : {};
  if (rest.length === 0) return {};
  const hints = { deliveryFee: first.charge, freeDeliveryAbove: rest[0].from };
  if ((flat !== null && flat !== hints.deliveryFee) || (above !== null && above !== hints.freeDeliveryAbove)) return {};
  return hints;
}

/** undefined: the family is not listed. null: listed with nothing in force (`{}`). Else its assignment tag. */
function familyTag(families: unknown, family: string): string | null | undefined {
  const entry = isRecord(families) ? families[family] : undefined;
  if (!isRecord(entry)) return undefined;
  if (Object.keys(entry).length === 0) return null;
  return textOf(at(entry, CART.familyTag)) ?? undefined;
}

/** The amount of the one additional charge carrying `tag`, when it is flat (the same at every cart value). */
function flatChargeAmount(charges: unknown, tag: string): number | null {
  if (!Array.isArray(charges)) return null;
  const matches = charges.filter((c) => textOf(at(c, CART.chargeTag)) === tag);
  if (matches.length !== 1) return null;
  const amount = numberOf(at(matches[0], CART.chargeAmount));
  if (amount === null || amount < 0) return null;
  const variations = at(matches[0], CART.chargeVariations);
  if (Array.isArray(variations) && variations.some((v) => numberOf(at(v, CART.variationAmount)) !== amount)) return null;
  return amount;
}

/**
 * The guest cart's answer (POST /v5/carts, empty) → the fees Blinkit states
 * for the point right now, or undefined when it states none we can use. Pure.
 * Throws UpstreamError when the answer is not a cart at all.
 */
export function parseCartFeeHints(json: unknown): FeeHints | undefined {
  if (!isRecord(json) || !isRecord(at(json, CART.data))) {
    throw new UpstreamError(`${HOST}: cart answer has no cart_data (shape changed?)`);
  }
  const hints: FeeHints = { ...deliveryHints(at(json, CART.deliveryRule)) };

  const families = at(json, CART.families);
  const handling = familyTag(families, HANDLING_FAMILY);
  if (handling === null) hints.handlingFee = 0;
  else if (handling !== undefined) {
    const amount = flatChargeAmount(at(json, CART.charges), handling);
    if (amount !== null) hints.handlingFee = amount;
  }

  const surge = at(json, CART.surge);
  const noSurge = textOf(at(surge, CART.surgeSource)) === NO_SURGE;
  const surgeAmount = numberOf(at(surge, CART.surgeAmount));
  if (noSurge && (surgeAmount === null || surgeAmount === 0)) hints.surgeFee = 0;
  else if (surgeAmount !== null && surgeAmount > 0 && (numberOf(at(surge, CART.surgeMov)) ?? 0) === 0) hints.surgeFee = surgeAmount;
  const blockBelow = numberOf(at(surge, CART.checkoutBlockMov));
  if (blockBelow !== null && blockBelow > 0) hints.minOrder = blockBelow;

  // The surge block carries a small-cart fee config Blinkit can switch on; only
  // "no family assigned and no surge" is a statement that none is charged.
  if (familyTag(families, SMALL_CART_FAMILY) === null && noSurge) hints.smallCartFee = 0;

  return Object.keys(hints).length > 0 ? hints : undefined;
}

// --- Store context ----------------------------------------------------------

/** Kept in ResolvedStore.context. Plain data; `merchantIds` is refreshed in place. */
interface BlinkitStoreContext {
  lat: string;
  lon: string;
  merchantIds: string[];
}

function pointOf(location: GeoLocation): { lat: string; lon: string } {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    throw new UpstreamError(`${HOST}: location has no usable coordinates`);
  }
  // Six decimals is ~0.1 m. Number() drops trailing zeros: "12.9352", not "12.935200".
  return { lat: String(Number(location.lat.toFixed(6))), lon: String(Number(location.lng.toFixed(6))) };
}

function contextOf(store: ResolvedStore): BlinkitStoreContext {
  const c = store.context;
  if (
    typeof c.lat !== 'string' ||
    typeof c.lon !== 'string' ||
    !Array.isArray(c.merchantIds) ||
    !c.merchantIds.every((m) => typeof m === 'string')
  ) {
    throw new UpstreamError(`${HOST}: store ${store.storeId} was not resolved by the Blinkit adapter`);
  }
  // The same object the store cache holds, so a refresh below persists.
  return c as unknown as BlinkitStoreContext;
}

// --- Transport --------------------------------------------------------------

let client: Impit | null = null;
function blinkitClient(): Impit {
  client ??= createImpersonator({ browser: IMPIT_BROWSER });
  return client;
}

async function blinkitJson(
  url: string,
  point: { lat: string; lon: string },
  ctx: AdapterContext,
  init: { method: 'GET' | 'POST'; body?: string; referer: string; headers?: Readonly<Record<string, string>>; timeoutMs?: number },
): Promise<unknown> {
  return impersonateJson<unknown>(url, {
    client: blinkitClient(),
    method: init.method,
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: ctx.signal,
    timeoutMs: init.timeoutMs ?? REQUEST_TIMEOUT_MS,
    headers: {
      ...FETCH_HEADERS,
      ...CLIENT_HEADERS,
      ...init.headers,
      device_id: DEVICE_ID,
      // Chrome sends Origin on a same-origin POST, not on a GET.
      ...(init.method === 'POST' ? { origin: ORIGIN } : {}),
      referer: init.referer,
      [HEADER_LAT]: point.lat,
      [HEADER_LON]: point.lon,
      cookie: `${COOKIE_LAT}=${point.lat}; ${COOKIE_LON}=${point.lon}`,
    },
  });
}

async function fetchEta(point: { lat: string; lon: string }, ctx: AdapterContext): Promise<ParsedEta> {
  const json = await blinkitJson(`${ORIGIN}${ETA_PATH}`, point, ctx, { method: 'GET', referer: `${ORIGIN}/` });
  return parseEtaResponse(json);
}

/**
 * The fees Blinkit states for the point, from an empty guest cart. Never
 * throws: without them the catalog's fees apply, and the store is still good.
 */
async function fetchFeeHints(point: { lat: string; lon: string }, ctx: AdapterContext): Promise<FeeHints | undefined> {
  try {
    const json = await blinkitJson(`${ORIGIN}${CART_PATH}`, point, ctx, {
      method: 'POST',
      body: CART_BODY,
      referer: `${ORIGIN}/`,
      headers: CART_HEADERS,
      timeoutMs: FEE_TIMEOUT_MS,
    });
    const hints = parseCartFeeHints(json);
    if (!hints) ctx.log('guest cart stated no fee this adapter can read; catalog fees apply');
    return hints;
  } catch (e) {
    ctx.log(`fee lookup failed (${e instanceof Error ? e.message : String(e)}); catalog fees apply`);
    return undefined;
  }
}

/** `https://blinkit.com/v1/layout/search?q=amul%20butter&search_type=type_to_search` */
export function searchUrl(term: string): string {
  return `${ORIGIN}${SEARCH_PATH}?${PARAM_QUERY}=${encodeURIComponent(term)}&${PARAM_SEARCH_TYPE}=${SEARCH_TYPE}`;
}

// --- Location check ---------------------------------------------------------

/** One in-flight re-resolution per store context, shared by concurrent searches. */
const refreshing = new WeakMap<BlinkitStoreContext, Promise<ParsedEta>>();

function refreshMerchants(where: BlinkitStoreContext, ctx: AdapterContext): Promise<ParsedEta> {
  let pending = refreshing.get(where);
  if (!pending) {
    pending = fetchEta(where, ctx).finally(() => refreshing.delete(where));
    refreshing.set(where, pending);
  }
  return pending;
}

/**
 * Refuses a page priced at merchants that do not serve the store's point.
 *
 * Blinkit reassigns a point's dark store within minutes (33684 → 47074 in
 * Andheri West), so a mismatch first triggers one fresh ETA lookup for the same
 * coordinates. Only a mismatch that survives it is refused.
 */
async function assertSameLocation(page: ParsedSearch, where: BlinkitStoreContext, ctx: AdapterContext): Promise<void> {
  const place = `${where.lat},${where.lon}`;
  if (page.unlocated > 0) {
    throw new UpstreamError(`${HOST}: ${page.unlocated} row(s) carry no merchant_id, so their location cannot be checked`);
  }
  if (page.merchantIds.every((m) => where.merchantIds.includes(m))) return;

  const fresh = await refreshMerchants(where, ctx);
  if (!fresh.serviceable) {
    throw new UpstreamError(`${HOST}: search priced at merchant(s) ${page.merchantIds.join(', ')}, but ${place} is now "${fresh.status}"`);
  }
  if (fresh.merchantIds.join() !== where.merchantIds.join()) {
    ctx.log(`serving merchants changed: ${where.merchantIds.join(', ')} → ${fresh.merchantIds.join(', ')}`);
    where.merchantIds = fresh.merchantIds;
  }
  const strangers = page.merchantIds.filter((m) => !fresh.merchantIds.includes(m));
  if (strangers.length > 0) {
    throw new UpstreamError(
      `${HOST}: results priced at merchant(s) ${strangers.join(', ')}, which do not serve ${place} ` +
        `(served by ${fresh.merchantIds.join(', ')}); refusing rows from another location`,
    );
  }
}

// --- Adapter ----------------------------------------------------------------

const adapter: PlatformAdapter = {
  id: 'blinkit',
  transport: 'impersonate',

  async resolveStore(location, ctx) {
    const point = pointOf(location);
    // Side by side: the fee call needs only the point, and never throws.
    const [eta, feeHints] = await Promise.all([fetchEta(point, ctx), fetchFeeHints(point, ctx)]);
    if (!eta.serviceable) {
      ctx.log(`store lookup: ${eta.status}`);
      return null;
    }
    // The store cache keeps this object and contextOf() hands the same one to
    // every search, so a merchant refresh made by one search persists.
    const context: BlinkitStoreContext = { lat: point.lat, lon: point.lon, merchantIds: eta.merchantIds };
    return {
      storeId: eta.merchantId,
      // Blinkit's ETA answer names no locality, so this is the user's own label when there is one.
      label: textOf(location.label) ?? `Blinkit store ${eta.merchantId}`,
      eta: eta.minutes === null ? null : `${eta.minutes} min${eta.minutes === 1 ? '' : 's'}`,
      ...(feeHints ? { feeHints } : {}),
      context: { ...context },
    };
  },

  async search(query, store, ctx) {
    const term = query.replace(/\s+/g, ' ').trim();
    if (term === '') return [];
    const where = contextOf(store);

    const json = await blinkitJson(searchUrl(term), where, ctx, {
      method: SEARCH_METHOD,
      body: SEARCH_BODY,
      referer: `${ORIGIN}${SEARCH_PAGE_PATH}?${PARAM_QUERY}=${encodeURIComponent(term)}`,
    });
    const page = parseSearchResponse(json);
    if (page.unpriced > 0) ctx.log(`dropped ${page.unpriced} card(s) that could not be priced`);
    if (page.listings.length === 0) return [];

    await assertSameLocation(page, where, ctx);
    return page.listings;
  },
};

export default adapter;
