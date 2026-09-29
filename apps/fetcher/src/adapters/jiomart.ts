/**
 * JioMart (https://www.jiomart.com) — "JioMart Quick" grocery, over plain HTTP.
 *
 * ---------------------------------------------------------------------------
 * VERIFICATION LOG — probed live on 2026-09-27 from an Indian residential IP
 * (Bengaluru) with a desktop Chrome UA. VERIFIED means seen in a real response
 * that day; ASSUMED is a judgement call a maintainer should retest.
 *
 *  VERIFIED  JioMart runs on Fynd. The search page embeds a public
 *            `applicationID` / `applicationToken` in `window.APP_DATA`, and the
 *            Fynd SDK in the theme bundle sends
 *            `Authorization: Bearer base64(<id>:<token>)` plus
 *            `x-location-detail: JSON.stringify(locationDetails)` on every call
 *            (SDK `execute()`). The SDK also signs with x-fp-signature, but no
 *            endpoint used here needs it.
 *  VERIFIED  Store lookup is the SDK's `getServiceableStores`, i.e.
 *            GET {DELIVERY_PROMISE_URL} with `x-location-detail:
 *            {"pincode","country","country_iso_code"}` — no city/state needed.
 *            560034 → 14 stores; the one grocery store is uid 13845
 *            ("Groceries-TM3D", "Delivery in 20 mins"); 400053 → uid 3
 *            ("Delivery in 26 mins"); 110001 → six Electronics stores and no
 *            grocery store, so it is NOT serviceable for groceries.
 *  VERIFIED  2026-09-29: quick-commerce stores are matched by POLYGON
 *            (`meta.polygon_id`), so the point matters, not just the
 *            pincode. With the pincode alone 110017 (Delhi) and 700064
 *            (Kolkata) answered NO store at all; with the site's own
 *            `x-geolocation: {"latitude":"28.5355","longitude":"77.209"}`
 *            (strings, as its location flow sets them) 110017 → grocery
 *            store 13586 TL5T "Delivery in 21 mins", 700064 → 13822 TM6N
 *            "20 mins". So the lookup always sends the coordinates.
 *  VERIFIED  The same uid can appear twice under different departments
 *            (400053: uid 3 as Groceries AND as Electronics), and non-grocery
 *            stores also carry a Groceries `mbv_config`. So the store is chosen
 *            by `department_name`, exactly like the theme's `qcPromiseCall`,
 *            never by the mbv config.
 *  VERIFIED  Search is the SDK's `catalog.getProducts({q, f, pageSize: 12})`.
 *            On api.jiomartjcp.com it 302s to /ext/vertex/..., which only
 *            answers on www.jiomart.com (SEARCH_URL). The site builds the filter
 *            as `journey:quickcommerce:::store_ids:<uid>[||<uid>...]`.
 *  VERIFIED  Without the store filter (and header) the endpoint answers
 *            400 {"message":"invalid pincode"} — the filter is the location.
 *            The response is CDN-cached per URL (cache-control max-age=300).
 *  VERIFIED  Every row carries `price_list[]` with `store_id` = the filtered
 *            store and its own `price` / `is_sellable`, plus `store_ids[]`.
 *            That is the location evidence STORE_EVIDENCE checks: a row priced
 *            for another store is refused (UpstreamError), never shown.
 *  VERIFIED  Prices are rupees as numbers (`price.effective.min` = payable,
 *            `price.marked.min` = MRP), e.g. Good Life Tur Dal 1 kg 163 / 240.
 *            The card reads `price.effective.min`.
 *  VERIFIED  The card's quantity text is `${net-quantity-value}
 *            ${net-quantity-unit}` ("1 kg", "500 g", "1 L"), falling back to
 *            `sizes[0]` unless it is "OS", then "1 Pack" (QUANTITY below).
 *  VERIFIED  A nonsense query returns 200 with `items: []` (no LLM filler).
 *  VERIFIED  Product page: https://www.jiomart.com/product/<slug>.
 *  VERIFIED  robots.txt: www allows "/"; api.jiomartjcp.com has
 *            "Disallow: /", which covers delivery-promise. This is a
 *            user-initiated lookup, cached 24 h per pincode, not a crawl.
 *
 *  VERIFIED  `mbv_config` Groceries `min_basket_value` (99 everywhere seen) is
 *            a hard minimum order, reported as feeHints.minOrder: the cart
 *            theme bundle reads it back (`jio_mbv_details`) and, below it,
 *            prints "Shop for ₹X more from groceries to place order"
 *            (checked in the bundle 2026-09-29).
 *  VERIFIED  Delivery fee, 2026-09-29, logged out: GET {DELIVERY_FEE_QUOTE_URL}
 *            ?store_code=<grocery store code> with `x-application-id` — the
 *            theme's own call for its "Shop for ₹X to unlock free delivery on
 *            your quick grocery order" strip. `result.delivery_fee_list[]`
 *            entry `config_name: "SMART_BAZAAR_BASKET"` (the quick-grocery
 *            basket the cart's free-delivery card keys on) → shipping_fee 30,
 *            free_shipping_threshold 199, for TM3D (Bengaluru) and TZT7
 *            (Mumbai) alike; `store_cohort.store_code` echoes the store. The
 *            cart shows "Free Delivery unlocked" once the shortfall is ≤ 0,
 *            i.e. from the threshold itself. One extra request per store
 *            lookup (cached 24 h); failures leave the catalog's fee.
 *  ASSUMED   `is_accepting_order: false` or a `fulfillment_status.state` of
 *            PAUSED/CLOSED means "cannot order here now" → null. Neither was
 *            observed live; the shape comes from the theme's own mock store.
 *  ASSUMED   Prices may be national while assortment and stock are per store
 *            (probe: the 4 overlapping toor dal SKUs had identical prices).
 *            The adapter does not rely on this either way.
 *
 * WHEN THIS BREAKS, RE-CHECK IN THIS ORDER:
 *   1. APPLICATION_ID / APPLICATION_TOKEN: view-source a search page and look
 *      for "applicationID" in APP_DATA (401/403 → reported as `blocked`).
 *   2. SEARCH_URL still answers on www (a 404 means the vertex proxy moved).
 *   3. price_list / store_ids still present: without them every search
 *      reports `error` (location unverifiable) — safe, visible, fix it.
 *   4. Cities going "not serviceable" wholesale: the delivery-promise call
 *      headers (x-geolocation shape) against what the site's location flow
 *      sends (search its theme bundle for "x-geolocation").
 *   5. "fee quote failed" in the log: DELIVERY_FEE_QUOTE_URL and the
 *      SMART_BAZAAR_BASKET config name (theme bundle, "jmshipmentfee").
 * ---------------------------------------------------------------------------
 */

import type { FeeHints, GeoLocation, Listing } from '@gc/engine';
import { UpstreamError } from '../errors';
import { plainJson } from '../transports/plain';
import type { AdapterContext, PlatformAdapter, ResolvedStore } from './types';

// --- Endpoints & wire constants ----------------------------------------------

export const SITE = 'https://www.jiomart.com';
export const DELIVERY_PROMISE_URL = 'https://api.jiomartjcp.com/service/application/logistics/v1.0/delivery-promise';
export const SEARCH_URL = `${SITE}/ext/vertex/application/api/v1.0/products`;
/** The theme's delivery-fee quote (its "unlock free delivery" strip). */
export const DELIVERY_FEE_QUOTE_URL = `${SITE}/ext/jmshipmentfee/delivery_fee/v1.0/quote`;
const PRODUCT_PATH = '/product/';

/** Public Fynd storefront credentials from the page's APP_DATA (not a secret). */
const APPLICATION_ID = '685945f46c8c7aee3f3af605';
const APPLICATION_TOKEN = 'TpKw7wD9h';
const AUTHORIZATION = `Bearer ${btoa(`${APPLICATION_ID}:${APPLICATION_TOKEN}`)}`;
const LOCATION_HEADER = 'x-location-detail';
/** The point, as the site's location flow sends it; quick stores are matched by polygon. */
const GEOLOCATION_HEADER = 'x-geolocation';
const APPLICATION_ID_HEADER = 'x-application-id';
const PARAM_STORE_CODE = 'store_code';
/** The fee config of a quick grocery basket, as the theme picks it from the quote. */
const QUICK_GROCERY_FEE_CONFIG = 'SMART_BAZAAR_BASKET';
/** Fees are a nicety on top of the store; a slow quote must not hold the store lookup long. */
const FEE_TIMEOUT_MS = 4000;

const QUICK_JOURNEY = 'quickcommerce';
const GROCERY_DEPARTMENT = 'groceries';
/** The site's own page size; also keeps us on the CDN-cached URL shape. */
const PAGE_SIZE = 12;
const MAX_LISTINGS = 20;

const PARAM_QUERY = 'q';
const PARAM_FILTER = 'f';
const PARAM_PAGE_SIZE = 'page_size';
const storeFilter = (uid: number) => `journey:${QUICK_JOURNEY}:::store_ids:${uid}`;

/** "Delivery in 20 mins" → "20 mins". */
const ETA_PREFIX_RE = /^\s*delivery\s+in\s+/i;
const PAUSED_STATES = new Set(['PAUSED', 'CLOSED']);
const PINCODE_RE = /^[1-9]\d{5}$/;
/** Size placeholder Fynd uses for single-size items. */
const ONE_SIZE = 'OS';
/** What the product card prints when it has no quantity at all. */
const NO_QUANTITY_TEXT = '1 Pack';

// --- Response shapes (only what we read; everything optional) ----------------

interface JioPrice {
  effective?: { min?: number | string | null; max?: number | string | null } | null;
  marked?: { min?: number | string | null; max?: number | string | null } | null;
}

interface JioJourneyPromise {
  journey?: string | null;
  priority?: number | null;
  meta?: { mbv_config?: { department?: string | null; min_basket_value?: number | null }[] | null } | null;
  delivery_promise?: { message?: string | null; eta_mins?: number | null } | null;
}

export interface JioStore {
  uid?: number | null;
  code?: string | null;
  display_name?: string | null;
  department_name?: string | null;
  is_accepting_order?: boolean | null;
  fulfillment_status?: { state?: string | null; customer_message?: string | null } | null;
  address?: { pincode?: string | null; city?: string | null } | null;
  journey_wise_promise?: JioJourneyPromise[] | null;
}

export interface JioDeliveryPromiseResponse {
  items?: JioStore[] | null;
}

export interface JioItem {
  type?: string | null;
  uid?: number | string | null;
  name?: string | null;
  slug?: string | null;
  sellable?: boolean | null;
  brand?: { name?: string | null } | null;
  'net-quantity-value'?: number | string | null;
  'net-quantity-unit'?: string | null;
  sizes?: string[] | null;
  price?: JioPrice | null;
  price_list?: { store_id?: number | null; is_sellable?: boolean | null; price?: JioPrice | null }[] | null;
  store_ids?: number[] | null;
  medias?: { url?: string | null; type?: string | null }[] | null;
  attributes?: Record<string, unknown> | null;
  hierarchy?: { l3_category?: { name?: string | null } | null } | null;
}

export interface JioSearchResponse {
  items?: JioItem[] | null;
}

// --- Store lookup --------------------------------------------------------------

export interface PickedStore {
  uid: number;
  code: string;
  city: string | null;
  eta: string | null;
  minOrder: number | null;
}

function quickPromise(store: JioStore): JioJourneyPromise | undefined {
  return store.journey_wise_promise?.find((j) => j?.journey === QUICK_JOURNEY);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The grocery store the site itself would pick for this pincode, or null when
 * there is none (or it is not taking orders). Mirrors the theme's
 * `qcPromiseCall`: group by department, keep the quick-commerce promise with
 * the lowest priority.
 */
export function pickGroceryStore(json: JioDeliveryPromiseResponse): PickedStore | null {
  if (!json || !Array.isArray(json.items)) {
    throw new UpstreamError('JioMart delivery-promise response had no items array');
  }
  let best: { store: JioStore; promise: JioJourneyPromise } | null = null;
  for (const store of json.items) {
    if (store?.department_name?.toLowerCase() !== GROCERY_DEPARTMENT) continue;
    const promise = quickPromise(store);
    if (!promise || typeof store.uid !== 'number' || !Number.isInteger(store.uid) || store.uid <= 0) continue;
    // A store that cannot take an order now is no store for a price plan.
    if (store.is_accepting_order === false) continue;
    if (PAUSED_STATES.has(String(store.fulfillment_status?.state ?? '').toUpperCase())) continue;
    const rank = promise.priority ?? Number.MAX_SAFE_INTEGER;
    const bestRank = best?.promise.priority ?? Number.MAX_SAFE_INTEGER;
    if (!best || rank < bestRank) best = { store, promise };
  }
  if (!best) return null;

  const { store, promise } = best;

  const message = promise.delivery_promise?.message?.trim() ?? '';
  const etaMins = promise.delivery_promise?.eta_mins;
  const eta = message
    ? message.replace(ETA_PREFIX_RE, '')
    : typeof etaMins === 'number' && etaMins > 0
      ? `${etaMins} mins`
      : null;

  const mbv = promise.meta?.mbv_config?.find((m) => m?.department?.toLowerCase() === GROCERY_DEPARTMENT);
  const minOrder = typeof mbv?.min_basket_value === 'number' && mbv.min_basket_value > 0 ? mbv.min_basket_value : null;

  const city = store.address?.city?.trim() ? titleCase(store.address.city.trim()) : null;
  return { uid: store.uid as number, code: store.code?.trim() || String(store.uid), city, eta, minOrder };
}

function locationDetail(pincode: string): string {
  return JSON.stringify({ pincode, country: 'India', country_iso_code: 'IN' });
}

/** `{"latitude":"28.5355","longitude":"77.209"}` — strings, exactly as the site's location flow sets it. */
function geolocation(location: GeoLocation): string | null {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  return JSON.stringify({ latitude: String(location.lat), longitude: String(location.lng) });
}

// --- Fees ------------------------------------------------------------------------

export interface JioFeeQuoteResponse {
  result?: {
    delivery_fee_list?:
      | {
          config_name?: string | null;
          shipping_fee?: number | string | null;
          free_shipping_threshold?: number | string | null;
          store_cohort?: { store_code?: string | null } | null;
        }[]
      | null;
  } | null;
}

function toAmount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Pure: the delivery-fee quote → the quick-grocery delivery fee and its
 * free-delivery threshold at `storeCode`, or undefined when the quote states
 * none this model can carry (no quick-grocery entry, or a fee with no
 * threshold). Throws UpstreamError on a changed shape or a quote for another store.
 */
export function parseFeeQuote(json: JioFeeQuoteResponse, storeCode: string): FeeHints | undefined {
  const list = json?.result?.delivery_fee_list;
  if (!Array.isArray(list)) throw new UpstreamError('JioMart fee quote had no result.delivery_fee_list');
  const entry = list.find((e) => e?.config_name === QUICK_GROCERY_FEE_CONFIG);
  if (!entry) return undefined;
  const quotedFor = entry.store_cohort?.store_code?.trim();
  if (quotedFor && quotedFor !== storeCode) {
    throw new UpstreamError(`JioMart quoted fees for store ${quotedFor}, not ${storeCode}`);
  }
  const fee = toAmount(entry.shipping_fee);
  const threshold = toAmount(entry.free_shipping_threshold);
  if (fee === null) return undefined;
  if (fee === 0) return { deliveryFee: 0 };
  return threshold !== null && threshold > 0 ? { deliveryFee: fee, freeDeliveryAbove: threshold } : undefined;
}

/** The fee quote for the store, or undefined. Never throws: the catalog covers a miss. */
async function fetchFeeQuote(store: PickedStore, ctx: AdapterContext): Promise<FeeHints | undefined> {
  // A store without its own code (code fell back to the uid) cannot be quoted.
  if (store.code === String(store.uid)) return undefined;
  try {
    const url = new URL(DELIVERY_FEE_QUOTE_URL);
    url.searchParams.set(PARAM_STORE_CODE, store.code);
    const json = await plainJson<JioFeeQuoteResponse>(url.toString(), {
      signal: ctx.signal,
      timeoutMs: FEE_TIMEOUT_MS,
      headers: { accept: 'application/json', [APPLICATION_ID_HEADER]: APPLICATION_ID, referer: `${SITE}/` },
    });
    const hints = parseFeeQuote(json, store.code);
    if (!hints) ctx.log(`fee quote for ${store.code} stated no quick-grocery fee; catalog delivery fee applies`);
    return hints;
  } catch (e) {
    ctx.log(`fee quote failed (${e instanceof Error ? e.message : String(e)}); catalog delivery fee applies`);
    return undefined;
  }
}

// --- Search parsing --------------------------------------------------------------

function toRupees(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stripQuotes(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/^["']+|["']+$/g, '').trim();
}

/** QUANTITY: exactly what the product card prints (see the log). */
export function quantityTextOf(item: JioItem): string {
  const value = stripQuotes(item['net-quantity-value']);
  const unit = stripQuotes(item['net-quantity-unit']);
  if (value !== '' && unit !== '') return `${value} ${unit}`;
  const size = item.sizes?.[0]?.trim();
  if (size && size.toUpperCase() !== ONE_SIZE) return size;
  return NO_QUANTITY_TEXT;
}

function categoryOf(item: JioItem): string | null {
  const l3 = item.attributes?.['l3-category'];
  if (Array.isArray(l3) && typeof l3[0] === 'string' && l3[0].trim()) return l3[0].trim();
  return item.hierarchy?.l3_category?.name?.trim() || null;
}

/**
 * STORE_EVIDENCE: which store this row was priced for. `price_list` names the
 * store per price; `store_ids` lists stores stocking the item. No evidence at
 * all counts as a mismatch — we cannot show a price we cannot place.
 */
function storeEntry(item: JioItem, storeUid: number) {
  const entry = item.price_list?.find((p) => p?.store_id === storeUid);
  const listed = Array.isArray(item.store_ids) && item.store_ids.includes(storeUid);
  return { entry, matches: entry !== undefined || listed };
}

/**
 * Pure: a search response → listings for `storeUid`. Throws UpstreamError when
 * the shape is wrong or any row is priced for a different store.
 */
export function parseSearchResponse(json: JioSearchResponse, storeUid: number, fetchedAt = new Date().toISOString()): Listing[] {
  if (!json || !Array.isArray(json.items)) {
    throw new UpstreamError('JioMart search response had no items array');
  }
  const listings: Listing[] = [];
  for (const item of json.items) {
    if (!item || (item.type && item.type !== 'product')) continue;

    const { entry, matches } = storeEntry(item, storeUid);
    if (!matches) {
      const seen = item.price_list?.map((p) => p?.store_id).join(',') || 'none';
      throw new UpstreamError(`JioMart priced item ${item.uid} for store(s) ${seen}, not ${storeUid}; refusing the results`);
    }

    const title = item.name?.trim() ?? '';
    const slug = item.slug?.trim() ?? '';
    const price = toRupees(entry?.price?.effective?.min ?? item.price?.effective?.min);
    if (!title || !slug || price === null || item.uid === null || item.uid === undefined) continue;

    const marked = toRupees(entry?.price?.marked?.min ?? item.price?.marked?.min);
    const image = item.medias?.find((m) => (m?.type ?? 'image') === 'image' && m?.url)?.url ?? null;

    listings.push({
      platformId: 'jiomart',
      listingId: String(item.uid),
      title,
      brand: item.brand?.name?.trim() || null,
      quantityText: quantityTextOf(item),
      price,
      mrp: marked !== null && marked >= price ? marked : null,
      inStock: item.sellable === true && entry?.is_sellable !== false,
      productUrl: `${SITE}${PRODUCT_PATH}${slug}`,
      imageUrl: image,
      category: categoryOf(item),
      fetchedAt,
    });
    if (listings.length >= MAX_LISTINGS) break;
  }
  return listings;
}

// --- Adapter ---------------------------------------------------------------------

interface JioContext {
  storeUid: number;
  pincode: string;
}

function requestHeaders(pincode: string): Record<string, string> {
  return { authorization: AUTHORIZATION, [LOCATION_HEADER]: locationDetail(pincode) };
}

const adapter: PlatformAdapter = {
  id: 'jiomart',
  transport: 'plain',

  async resolveStore(location: GeoLocation, ctx: AdapterContext): Promise<ResolvedStore | null> {
    const pincode = location.pincode?.trim() ?? '';
    if (!PINCODE_RE.test(pincode)) throw new Error(`JioMart needs a 6-digit pincode, got "${location.pincode}"`);

    const geo = geolocation(location);
    const json = await plainJson<JioDeliveryPromiseResponse>(DELIVERY_PROMISE_URL, {
      signal: ctx.signal,
      headers: { ...requestHeaders(pincode), ...(geo ? { [GEOLOCATION_HEADER]: geo } : {}) },
    });
    const picked = pickGroceryStore(json);
    if (!picked) {
      ctx.log(`no grocery store accepting orders at this ${geo ? 'point' : 'pincode'}`);
      return null;
    }
    const feeHints: FeeHints = {
      ...(picked.minOrder !== null ? { minOrder: picked.minOrder } : {}),
      ...(await fetchFeeQuote(picked, ctx)),
    };
    const context: JioContext = { storeUid: picked.uid, pincode };
    return {
      storeId: String(picked.uid),
      label: `JioMart store ${picked.code}${picked.city ? `, ${picked.city}` : ''}`,
      eta: picked.eta,
      feeHints: Object.keys(feeHints).length > 0 ? feeHints : undefined,
      context: { ...context },
    };
  },

  async search(query: string, store: ResolvedStore, ctx: AdapterContext): Promise<Listing[]> {
    const { storeUid, pincode } = store.context as Partial<JioContext>;
    // The store filter IS the location. Without it JioMart would answer for
    // nowhere in particular (or 400); never search without one.
    if (typeof storeUid !== 'number' || !Number.isInteger(storeUid) || storeUid <= 0 || typeof pincode !== 'string') {
      throw new UpstreamError('JioMart store has no store uid; refusing to search without the store filter');
    }
    const term = query.trim();
    if (!term) return [];

    const url = new URL(SEARCH_URL);
    url.searchParams.set(PARAM_QUERY, term);
    url.searchParams.set(PARAM_FILTER, storeFilter(storeUid));
    url.searchParams.set(PARAM_PAGE_SIZE, String(PAGE_SIZE));

    const json = await plainJson<JioSearchResponse>(url.toString(), {
      signal: ctx.signal,
      headers: requestHeaders(pincode),
    });
    return parseSearchResponse(json, storeUid);
  },
};

export default adapter;
