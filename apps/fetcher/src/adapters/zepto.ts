/**
 * Zepto — quick-commerce adapter over Zepto's own web APIs, through the
 * `browser` transport (a real Chromium page on www.zepto.com).
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE — probed live on 2026-09-27 from a residential IP in Bengaluru
 * (spike S2, docs/research/2026-09-27-spike-s2-zepto-instamart.md). Read this
 * before trusting a row.
 *
 * VERIFIED LIVE (2026-09-27):
 *   - Plain HTTP to www.zepto.com and bff-gateway.zepto.com gets AWS WAF's
 *     202 + `x-amzn-waf-action: challenge`. In Chromium the challenge script
 *     runs, earns an `aws-waf-token` cookie (on .zepto.com, 4-day expiry) and
 *     reloads into the real site. Headless works only with the transport's UA
 *     fix: with "HeadlessChrome" in the UA the token is issued but the reload
 *     is refused with a bare 429.
 *   - Location is the site's own cookies `latitude`, `longitude`,
 *     `user_position` — what its location picker writes. Set before the first
 *     load, the site's server answers with a `serviceability` cookie: primary,
 *     secondary and tertiary dark stores, ETA minutes, city and store name.
 *     An unserviceable point gives {"primaryStore":{"serviceable":false}}.
 *   - The primary store for one point changes between sessions: 12.9352,
 *     77.6245 got 796c71f3…, 5ec071fd…, bf1b6356… and 7e5a1821… within an
 *     hour. So resolveStore asks the site's own home-layout call (GET
 *     /lms/api/v2/get_page?latitude&longitude&page_type=HOME…) every time:
 *     its storeServiceableResponse, storeServiceableInfo ETAs and ETA header
 *     ("10 minutes") are the assignment right now; the cookie is the fallback.
 *     An unserviceable point answers storeServiceableResponse {serviceable:
 *     false}. Every product carries the `storeId` it was priced at; the
 *     location check reads that, not the session.
 *   - Search is POST bff-gateway.zepto.com/user-search-service/api/v3/search,
 *     body {query, pageNumber:0, intentId, mode:"AUTOSUGGEST", userSessionId},
 *     exactly what the site sends when Enter is pressed in its search box. The
 *     store rides on the store_id / store_ids / store_etas headers.
 *   - Every bff-gateway call carries `request-signature` and `x-timezone`.
 *     Without them CloudFront answers 429 with no CORS headers, which a page
 *     sees only as "Failed to fetch". The web client computes both in an axios
 *     interceptor: request-signature = sha256 of the values of {body,
 *     deviceId, method, requestId, secret, url} joined with "|" in sorted-key
 *     order, where secret = the session's own XSRF-TOKEN cookie and url = path
 *     + query; x-timezone = sha256(request-signature). signRequest()
 *     reproduces the site's own signatures byte for byte (12 of 12 captured
 *     requests, GET and POST). Every input is issued to the anonymous browser
 *     session; no account or credential is involved.
 *   - Money is in paise. The page showed Milky Mist Table Butter at ₹73 (MRP
 *     ₹85); the JSON said discountedSellingPrice 7300, mrp 8500. Prices can
 *     carry paise (₹36.3 seen).
 *   - PDP links are /pn/<name-slug>/pvid/<productVariant.id>, read off the
 *     site's own product cards.
 *   - Results are PRODUCT_GRID widgets named SEARCHED_PRODUCTS_<n>;
 *     ORTHOGONAL_CROSS_SELL_WIDGET is cross-sell and skipped. One product can
 *     appear twice (sponsored slot + organic slot); deduplicated by variant.
 *   - Anonymous responses carry no fee facts (the "₹0 fees above a minimum
 *     order" banner is an image), so this adapter sends no feeHints.
 *     Re-checked 2026-09-29, Bengaluru and Mumbai
 *     (docs/research/2026-09-29-live-fees.md): the only JSON the home page
 *     loads for a guest is get_page, which says `storeDetailsResponse.raining`
 *     (false) and `mismatchTriggers.checkMovMismatch` but no amount. The
 *     page's fee texts ("Rain Fee In Effect", "Surge Pricing In Effect") are
 *     templates filled from the cart. The cart is `POST cfs/api/v1/cart/create`
 *     (then PUT cfs/api/v1/cart), which the site sends only once the cart holds
 *     an item; an empty signed call from a guest session passed CORS preflight
 *     and was then refused at the edge without CORS headers (possibly the
 *     burst limit — see the note). A priced cart would need a product variant
 *     id, which a store lookup does not have. So still no feeHints.
 *   - Spike S2 (headless, residential IP): 10/10 searches priced, 240–790 ms
 *     each warm; a cold session (launch + challenge + location) ~5–6.5 s. A
 *     session page stayed valid across idle gaps (see the spike note).
 *   - A 429 with CORS headers is reported as blocked without recycling the
 *     session (RateLimitedError): back off, don't dodge. The CORS-less
 *     CloudFront refusal is recycled once, since a fresh challenge can fix it.
 *
 * ASSUMPTIONS (not verified):
 *   - discountedSellingPrice is what a logged-out visitor pays. It equalled
 *     sellingPrice and superSaverSellingPrice in every row seen. zeptoPassPrice
 *     is a member price and is ignored.
 *   - `x-widget-id` (the site picks one at random from its "passkeys" feature
 *     flag) is not enforced today; we send whichever the site itself used.
 *   - SEARCH_COMPATIBLE_COMPONENTS (copied from the site's search request on
 *     2026-09-27) shapes the response format; its exact effect is unknown.
 *   - Searches keep naming the stores resolveStore returned for as long as the
 *     fetcher caches them (10 min for Zepto), even if Zepto rotates the point
 *     to another store meanwhile: the rows are still a real, nearby store's
 *     prices, and that store is exactly what the location check holds them to.
 *
 * MAINTAINER, WHEN THIS BREAKS, IN ORDER:
 *   1. BlockedError "refused before any response": the signature scheme
 *      changed. Search the site's JS for "request-signature" (an axios request
 *      interceptor) and update signRequest().
 *   2. BlockedError or TimeoutError during session setup: the WAF refused the
 *      browser itself — see transports/browser.ts.
 *   3. 200 but no rows: SEARCH_WIDGET_PREFIX and the PRODUCT paths.
 *   4. Prices 100× off: PAISE_PER_RUPEE.
 * ---------------------------------------------------------------------------
 */
import { createHash, randomUUID } from 'node:crypto';
import type { BrowserContext, Page, Request } from 'playwright';
import type { GeoLocation, Listing } from '@gc/engine';
import { BlockedError, TimeoutError, UpstreamError } from '../errors';
import {
  BrowserFetchError,
  RateLimitedError,
  assertPageResponseNotBlocked,
  cookieJar,
  dropSession,
  openThroughChallenge,
  pageFetch,
  withSession,
  type PageFetchResult,
  type SessionOptions,
} from '../transports/browser';
import type { AdapterContext, PlatformAdapter, ResolvedStore } from './types';

// --- Endpoints ---------------------------------------------------------------

const SITE_HOST = 'www.zepto.com';
const SITE_ORIGIN = `https://${SITE_HOST}`;
const SITE_HOME = `${SITE_ORIGIN}/`;
const API_HOST = 'bff-gateway.zepto.com';
const API_ORIGIN = `https://${API_HOST}`;
const SEARCH_PATH = '/user-search-service/api/v3/search';
/**
 * The home layout the site loads for a location. Its storeServiceableResponse
 * and ETA header are the platform's current store assignment for that point.
 */
const STORE_PAGE_PATH = '/lms/api/v2/get_page';
/** The site's own query for it, minus the coordinates. */
const STORE_PAGE_PARAMS = { page_type: 'HOME', version: 'v2', show_new_eta_banner: 'true', page_size: '3', enforce_platform_type: 'DESKTOP' };
/** The reverse geocoder behind the site's "Use My Current Location": {label, shortAddress, …}. */
const AREA_PATH = '/api/v1/user/customer/address/location';
const PRODUCT_PATH = (slug: string, variantId: string) => `/pn/${slug}/pvid/${variantId}`;
/** ImageKit transform: 400 px square, what the site's own cards request (verified to resolve). */
const IMAGE_BASE = 'https://cdn.zeptonow.com/production/tr:w-400,ar-1-1,pr-true,f-auto,q-80/';

// --- Cookies (location in; session identity out) --------------------------------

const COOKIE = {
  latitude: 'latitude',
  longitude: 'longitude',
  userPosition: 'user_position',
  serviceability: 'serviceability',
  xsrf: 'XSRF-TOKEN',
  csrfSecret: 'csrfSecret',
  deviceId: 'device_id',
  sessionId: 'session_id',
} as const;
/** Set by the real page (not the challenge page); their presence means the site is up. */
const READY_COOKIES = [COOKIE.serviceability, COOKIE.xsrf, COOKIE.deviceId, COOKIE.sessionId];
/** The site keeps its location cookies for a year. */
const LOCATION_COOKIE_TTL_S = 365 * 24 * 60 * 60;

// --- Request identity -----------------------------------------------------------

/** Copied from the site's own signed API requests, so they follow its deploys. */
const COPIED_HEADERS = ['app_version', 'marketplace_type', 'x-widget-id'] as const;
const FALLBACK_IDENTITY: Record<string, string> = { app_version: '17.0.1', marketplace_type: 'SUPER_SAVER' };
const STATIC_HEADERS: Record<string, string> = {
  accept: 'application/json, text/plain, */*',
  platform: 'WEB',
  app_sub_platform: 'WEB',
  tenant: 'ZEPTO',
  auth_from_cookie: 'true',
  auth_revamp_flow: 'v2',
  source: 'DIRECT',
  'x-without-bearer': 'true',
};
/** The search request's own feature list, verbatim from the site on 2026-09-27. */
const SEARCH_COMPATIBLE_COMPONENTS =
  'EXTERNAL_COUPONS,BUNDLE,MULTI_SELLER_ENABLED,ROLLUPS,SCHEDULED_DELIVERY,HOMEPAGE_V2,NEW_ETA_BANNER,VERTICAL_FEED_PRODUCT_GRID,' +
  'AUTOSUGGESTION_PAGE_ENABLED,AUTOSUGGESTION_PIP,AUTOSUGGESTION_AD_PIP,BOTTOM_NAV_FULL_ICON,COUPON_WIDGET_CART_REVAMP,' +
  'DELIVERY_UPSELLING_WIDGET,MARKETPLACE_CATEGORY_GRID,NO_PLATFORM_CHECK_ENABLED_V2,SUPER_SAVER:1,SUPERSTORE_V1,PROMO_CASH:0,' +
  '24X7_ENABLED_V1,TABBED_CAROUSEL_V2,HP_V4_FEED,WIDGET_BASED_ETA,PC_REVAMP_1,NO_COST_EMI_V1,PRE_SEARCH,ITEMISATION_ENABLED,' +
  'ZEPTO_PASS:5,BACHAT_FOR_ALL,SAMPLING_UPSELL_CAMPAIGN,DISCOUNTED_ADDONS_ENABLED,UPSELL_COUPON_SS:0,ENABLE_FLOATING_CART_BUTTON,' +
  'FASHION_REVAMP,WIDGET_RESTRUCTURE,MULTITAB_V2,NEW_ROLLUPS_ENABLED,RERANKING_QCL_RELATED_PRODUCTS,PLP_ON_SEARCH,' +
  'PAAN_BANNER_WIDGETIZED,ROLLUPS_UOM,DYNAMIC_FILTERS,PHARMA_ENABLED,AUTOSUGGESTION_RECIPE_PIP,SEARCH_FILTERS_V1,' +
  'QUERY_DESCRIPTION_WIDGET,MEDS_WITH_SIMILAR_SALT_WIDGET,SEARCH_RELOOK,FILTER_ATTRIBUTES,LMS_BROWSE,SEARCH_PRODUCT_GRID_V2,' +
  'L3_UNDERSTANDING_LAYOUT,NEW_BILL_INFO,RE_PROMISE_ETA_ORDER_SCREEN_ENABLED,MANUALLY_APPLIED_DELIVERY_FEE_RECEIVABLE,' +
  'MARKETPLACE_REPLACEMENT,CART_REDESIGN_ENABLED,SHIPMENT_WIDGETIZATION_ENABLED,GIFT_CARD,SCLP_ADD_MONEY,GIFTING_ENABLED,OFSE,' +
  'SWAP_AND_SAVE_ON_CART,PRICING_CAMPAIGN_ID,TABBED_CAROUSEL_V3,CART_LMS:2,SIZE_EXCHANGE_ENABLED,SAMPLING_V3,HYBRID_CAMPAIGN,';
/** "AUTOSUGGEST" is the full results page; "TYPED" is the dropdown shown while typing. */
const SEARCH_MODE = 'AUTOSUGGEST';
const SEARCH_PAGE_NUMBER = 0;

// --- Limits -------------------------------------------------------------------

const MAX_LISTINGS = 20;
const SEARCH_TIMEOUT_MS = 8_000;
const STORE_TIMEOUT_MS = 6_000;
const AREA_TIMEOUT_MS = 4_000;
const SETUP_TIMEOUT_MS = 25_000;
/** How long setup waits for the app's first own API call, to copy its identity. */
const IDENTITY_WAIT_MS = 6_000;

// --- Response shape ----------------------------------------------------------

const PAISE_PER_RUPEE = 100;

/** serviceability cookie (URL-encoded JSON). */
const SERVICEABILITY = {
  primary: 'primaryStore',
  secondary: 'secondaryStore',
  stores: 'storesData',
  serviceable: 'serviceable',
  storeId: 'storeId',
  etaMinutes: 'etaInMinutes',
  etaText: ['etaInformation', 'secondaryText'],
  city: ['storeDetailedInfo', 'city'],
  storeName: ['storeDetailedInfo', 'name'],
} as const;

/** get_page: the store assignment and the ETA header. */
const STORE_PAGE = {
  assignment: ['storeServiceableResponse'],
  serviceable: 'serviceable',
  storeId: 'storeId',
  secondaryIds: 'secondaryStoreIds',
  storeEtas: ['storeServiceableInfo', 'storeServiceability', 'data'],
  storeEta: 'eta',
  etaText: ['pageLayout', 'header', 'widget', 'data', 'etaInfo', 'secondaryText'],
  city: ['storeDetailsResponse', 'city', 'name'],
  storeName: ['storeDetailsResponse', 'name'],
} as const;

const SEARCH_LAYOUT_KEY = 'layout';
const SEARCH_WIDGET_NAME_KEY = 'widgetName';
const SEARCH_WIDGET_PREFIX = 'SEARCHED_PRODUCTS';
const SEARCH_WIDGET_ITEMS_PATH = ['data', 'resolver', 'data', 'items'];

/** One search hit: `items[i].productResponse`. Money fields are paise. */
const PRODUCT = {
  root: 'productResponse',
  storeId: ['storeId'],
  name: ['product', 'name'],
  brand: ['product', 'brand'],
  variantId: ['productVariant', 'id'],
  quantityText: ['productVariant', 'formattedPacksize'],
  images: ['productVariant', 'images'],
  imagePath: 'path',
  price: ['discountedSellingPrice'],
  priceFallback: ['sellingPrice'],
  mrp: ['mrp'],
  mrpFallback: ['productVariant', 'mrp'],
  outOfStock: ['outOfStock'],
  availableQuantity: ['availableQuantity'],
  category: ['primarySubcategoryName'],
  categoryFallback: ['primaryCategoryName'],
} as const;

const AREA_LABEL_KEY = 'label';

/** Catalogue placeholders Zepto puts in `brand` for loose produce ("Onion"); not brands. */
const PLACEHOLDER_BRANDS = new Set(['unbranded']);

// --- JSON readers ----------------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pluck(root: unknown, path: readonly string[]): unknown {
  let node = root;
  for (const key of path) {
    if (!isObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// --- Stores ---------------------------------------------------------------------

export interface ZeptoStores {
  serviceable: boolean;
  primaryId: string | null;
  secondaryId: string | null;
  /** ETA in minutes per store id, as the site keeps it. */
  etas: Record<string, number>;
  /** The site's own phrasing, e.g. "10 minutes". */
  etaText: string | null;
  city: string | null;
  storeName: string | null;
}

/** Reads the `serviceability` cookie the site sets for the session's location. */
export function parseServiceability(raw: unknown): ZeptoStores {
  const json = typeof raw === 'string' ? safeJson(raw) : raw;
  const primary = pluck(json, [SERVICEABILITY.primary]);
  if (!isObject(json) || !isObject(primary)) {
    throw new UpstreamError('zepto: serviceability cookie missing or unreadable');
  }
  const secondary = pluck(json, [SERVICEABILITY.secondary]);
  const etas: Record<string, number> = {};
  const storesData = pluck(json, [SERVICEABILITY.stores]);
  const stores: unknown[] = [primary, secondary, ...(isObject(storesData) ? Object.values(storesData) : [])];
  for (const s of stores) {
    const id = asString(pluck(s, [SERVICEABILITY.storeId]));
    const eta = asNumber(pluck(s, [SERVICEABILITY.etaMinutes]));
    if (id && eta !== null) etas[id] = eta;
  }
  return {
    serviceable: primary[SERVICEABILITY.serviceable] === true,
    primaryId: asString(primary[SERVICEABILITY.storeId]),
    secondaryId: isObject(secondary) && secondary[SERVICEABILITY.serviceable] !== false ? asString(secondary[SERVICEABILITY.storeId]) : null,
    etas,
    etaText: asString(pluck(json, SERVICEABILITY.etaText)),
    city: asString(pluck(json, SERVICEABILITY.city)),
    storeName: asString(pluck(json, SERVICEABILITY.storeName)),
  };
}

/** Reads the store assignment out of a get_page answer (the site's home layout for a point). */
export function parseStorePage(json: unknown): ZeptoStores {
  const assignment = pluck(json, STORE_PAGE.assignment);
  if (!isObject(assignment)) throw new UpstreamError('zepto: home layout has no storeServiceableResponse');
  const etas: Record<string, number> = {};
  const etaData = pluck(json, STORE_PAGE.storeEtas);
  if (isObject(etaData)) {
    for (const [id, v] of Object.entries(etaData)) {
      const eta = asNumber(pluck(v, [STORE_PAGE.storeEta]));
      if (eta !== null) etas[id] = eta;
    }
  }
  const secondaries = assignment[STORE_PAGE.secondaryIds];
  return {
    serviceable: assignment[STORE_PAGE.serviceable] === true,
    primaryId: asString(assignment[STORE_PAGE.storeId]),
    secondaryId: Array.isArray(secondaries) ? asString(secondaries[0]) : null,
    etas,
    etaText: asString(pluck(json, STORE_PAGE.etaText)),
    city: asString(pluck(json, STORE_PAGE.city)),
    storeName: asString(pluck(json, STORE_PAGE.storeName)),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** What search needs from resolveStore; kept in ResolvedStore.context. */
export interface ZeptoStoreContext {
  lat: number;
  lng: number;
  /** Primary first; what goes into store_ids and what results must be priced at. */
  storeIds: string[];
  storeEtas: Record<string, number>;
}

function readStoreContext(store: ResolvedStore): ZeptoStoreContext {
  const c = store.context as Partial<ZeptoStoreContext>;
  if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || !Array.isArray(c.storeIds) || c.storeIds.length === 0) {
    throw new UpstreamError('zepto: store context is missing its location or store ids');
  }
  return { lat: c.lat, lng: c.lng, storeIds: c.storeIds, storeEtas: c.storeEtas ?? {} };
}

// --- Request signing ---------------------------------------------------------------

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface SignInput {
  method: string;
  /** Path plus query string, e.g. "/user-search-service/api/v3/search". */
  url: string;
  requestId: string;
  deviceId: string;
  /** The session's XSRF-TOKEN cookie, decoded. */
  secret: string;
  /** The exact body string sent; undefined for GET. */
  body?: string;
}

/**
 * The web client's request signature (see PROVENANCE). The values are joined
 * in sorted-key order — body, deviceId, method, requestId, secret, url — and a
 * GET's missing body contributes the text "undefined", exactly as the site's
 * `reduce((acc, k) => acc + "|" + obj[k])` does.
 */
export function signRequest(input: SignInput): { signature: string; timezone: string } {
  const parts: Record<string, string | undefined> = {
    method: input.method.toLowerCase(),
    url: input.url,
    requestId: input.requestId,
    deviceId: input.deviceId,
    secret: input.secret,
    body: input.body,
  };
  const canonical = Object.keys(parts)
    .sort()
    .map((k) => String(parts[k]))
    .join('|');
  const signature = sha256Hex(canonical);
  return { signature, timezone: sha256Hex(signature) };
}

export interface ApiRequest {
  method: 'GET' | 'POST';
  /** Path + query on bff-gateway. */
  path: string;
  headers: Record<string, string>;
  body?: string;
}

interface RequestInput {
  jar: Record<string, string>;
  identity: Record<string, string>;
  store: Pick<ZeptoStoreContext, 'storeIds' | 'storeEtas'>;
  requestId: string;
}

function signedRequest(method: 'GET' | 'POST', path: string, body: string | undefined, input: RequestInput, extra: Record<string, string> = {}): ApiRequest {
  const { jar, identity, store, requestId } = input;
  const deviceId = jar[COOKIE.deviceId];
  const sessionId = jar[COOKIE.sessionId];
  const xsrf = jar[COOKIE.xsrf];
  if (!deviceId || !sessionId || !xsrf) throw new UpstreamError('zepto: session is missing its device/session/XSRF cookies');
  const { signature, timezone } = signRequest({ method, url: path, requestId, deviceId, secret: xsrf, body });
  const appVersion = identity.app_version ?? FALLBACK_IDENTITY.app_version;
  const primary = store.storeIds[0];
  const headers: Record<string, string> = {
    ...STATIC_HEADERS,
    ...extra,
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    app_version: appVersion,
    appversion: appVersion,
    marketplace_type: identity.marketplace_type ?? FALLBACK_IDENTITY.marketplace_type,
    device_id: deviceId,
    deviceid: deviceId,
    session_id: sessionId,
    sessionid: sessionId,
    request_id: requestId,
    requestid: requestId,
    // A session at an unserviceable point has no store yet; the site then sends none either.
    ...(primary
      ? {
          store_id: primary,
          storeid: primary,
          store_ids: store.storeIds.join(','),
          store_etas: JSON.stringify(Object.fromEntries(store.storeIds.map((id) => [id, store.storeEtas[id] ?? -1]))),
        }
      : {}),
    'x-xsrf-token': xsrf,
    'x-csrf-secret': jar[COOKIE.csrfSecret] ?? '',
    'request-signature': signature,
    'x-timezone': timezone,
  };
  if (identity['x-widget-id']) headers['x-widget-id'] = identity['x-widget-id'];
  return { method, path, headers, body };
}

/** The search request exactly as the site's search box sends it, signed. */
export function buildSearchRequest(query: string, input: RequestInput & { intentId: string }): ApiRequest {
  const body = JSON.stringify({
    query,
    pageNumber: SEARCH_PAGE_NUMBER,
    intentId: input.intentId,
    mode: SEARCH_MODE,
    userSessionId: input.jar[COOKIE.sessionId],
  });
  return signedRequest('POST', SEARCH_PATH, body, input, { compatible_components: SEARCH_COMPATIBLE_COMPONENTS });
}

// --- Search results ------------------------------------------------------------------

export interface ParseOptions {
  /** The store ids the request named; rows priced anywhere else are refused. */
  storeIds: readonly string[];
  fetchedAt: string;
  limit?: number;
}

/** The site's slug rule, as seen on its own cards ("Sambar Onion Peeled" → "sambar-onion-peeled"). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'product';
}

function paiseToRupees(paise: number): number {
  return Math.round(paise) / PAISE_PER_RUPEE;
}

function imageUrlOf(p: Json): string | null {
  const images = pluck(p, PRODUCT.images);
  if (!Array.isArray(images)) return null;
  for (const img of images) {
    const path = asString(pluck(img, [PRODUCT.imagePath]));
    if (!path) continue;
    return /^https?:\/\//i.test(path) ? path : `${IMAGE_BASE}${path.replace(/^\/+/, '')}`;
  }
  return null;
}

function brandOf(p: Json): string | null {
  const brand = asString(pluck(p, PRODUCT.brand));
  return brand && !PLACEHOLDER_BRANDS.has(brand.toLowerCase()) ? brand : null;
}

function toListing(p: Json, fetchedAt: string): Listing | null {
  const title = asString(pluck(p, PRODUCT.name));
  const variantId = asString(pluck(p, PRODUCT.variantId));
  const pricePaise = asNumber(pluck(p, PRODUCT.price)) ?? asNumber(pluck(p, PRODUCT.priceFallback));
  // No name, no variant or no positive price: nothing we could show honestly.
  if (!title || !variantId || pricePaise === null || pricePaise <= 0) return null;
  const mrpPaise = asNumber(pluck(p, PRODUCT.mrp)) ?? asNumber(pluck(p, PRODUCT.mrpFallback));
  const available = asNumber(pluck(p, PRODUCT.availableQuantity));
  return {
    platformId: 'zepto',
    listingId: variantId,
    title,
    brand: brandOf(p),
    quantityText: asString(pluck(p, PRODUCT.quantityText)) ?? '',
    price: paiseToRupees(pricePaise),
    // An MRP below the price means the fields changed meaning; show none rather than a negative saving.
    mrp: mrpPaise !== null && mrpPaise >= pricePaise ? paiseToRupees(mrpPaise) : null,
    inStock: pluck(p, PRODUCT.outOfStock) !== true && (available === null || available > 0),
    productUrl: `${SITE_ORIGIN}${PRODUCT_PATH(slugify(title), variantId)}`,
    imageUrl: imageUrlOf(p),
    category: asString(pluck(p, PRODUCT.category)) ?? asString(pluck(p, PRODUCT.categoryFallback)),
    fetchedAt,
  };
}

/**
 * Listings from one search response, in the site's order, deduplicated by
 * variant. Throws UpstreamError when any row is priced at a store the request
 * did not name, or when no row says which store it is priced at.
 */
export function parseSearchResponse(json: unknown, opts: ParseOptions): Listing[] {
  const layout = pluck(json, [SEARCH_LAYOUT_KEY]);
  if (!Array.isArray(layout)) throw new UpstreamError('zepto: search response has no layout');
  const limit = opts.limit ?? MAX_LISTINGS;
  const listings: Listing[] = [];
  const seen = new Set<string>();
  const foreign = new Set<string>();
  let products = 0;
  let unplaced = 0;
  for (const widget of layout) {
    const name = asString(pluck(widget, [SEARCH_WIDGET_NAME_KEY])) ?? '';
    if (!name.startsWith(SEARCH_WIDGET_PREFIX)) continue;
    const items = pluck(widget, SEARCH_WIDGET_ITEMS_PATH);
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const p = pluck(item, [PRODUCT.root]);
      if (!isObject(p)) continue;
      products++;
      const storeId = asString(pluck(p, PRODUCT.storeId));
      if (!storeId) {
        unplaced++;
        continue;
      }
      if (!opts.storeIds.includes(storeId)) {
        foreign.add(storeId);
        continue;
      }
      const listing = toListing(p, opts.fetchedAt);
      if (!listing || seen.has(listing.listingId)) continue;
      seen.add(listing.listingId);
      if (listings.length < limit) listings.push(listing);
    }
  }
  if (foreign.size > 0) {
    throw new UpstreamError(`zepto: results priced at store ${[...foreign].join(', ')}, not the requested ${opts.storeIds.join(', ')}`);
  }
  if (products > 0 && unplaced === products) {
    throw new UpstreamError('zepto: search rows no longer say which store they are priced at');
  }
  return listings;
}

// --- Session -----------------------------------------------------------------------

interface SessionState {
  /** Headers copied from the site's own signed requests. */
  identity: Record<string, string>;
  /** The area name for the session's point, asked once; undefined until then. */
  areaLabel?: string | null;
}

const states = new WeakMap<Page, SessionState>();

function sessionOptions(loc: { lat: number; lng: number }, signal?: AbortSignal): SessionOptions {
  return {
    // Same ~110 m cell as the fetcher's store cache.
    key: `zepto:${loc.lat.toFixed(3)},${loc.lng.toFixed(3)}`,
    geolocation: { latitude: loc.lat, longitude: loc.lng },
    signal,
    setup: (page, context) => setupSession(page, context, loc),
  };
}

/**
 * Opens www.zepto.com the way a returning visitor with a saved location would:
 * the location cookies are in place before the first request, the WAF
 * challenge runs, and the site's server answers with the stores for that point.
 */
async function setupSession(page: Page, context: BrowserContext, loc: { lat: number; lng: number }): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + LOCATION_COOKIE_TTL_S;
  const cookie = (name: string, value: string) => ({ name, value, domain: SITE_HOST, path: '/', expires, sameSite: 'Lax' as const });
  await context.addCookies([
    cookie(COOKIE.latitude, String(loc.lat)),
    cookie(COOKIE.longitude, String(loc.lng)),
    cookie(COOKIE.userPosition, encodeURIComponent(JSON.stringify({ latitude: loc.lat, longitude: loc.lng }))),
  ]);

  const identity: Record<string, string> = {};
  states.set(page, { identity });
  const copy = (req: Request) => {
    if (!req.url().startsWith(API_ORIGIN) || !req.headers()['request-signature']) return;
    for (const h of COPIED_HEADERS) {
      const v = req.headers()[h];
      if (v) identity[h] = v;
    }
  };
  page.on('request', copy);

  await openThroughChallenge(page, SITE_HOME, {
    timeoutMs: SETUP_TIMEOUT_MS,
    ready: async () => {
      const jar = await cookieJar(context, SITE_ORIGIN);
      return READY_COOKIES.every((name) => jar[name]);
    },
  });
  if (!identity.app_version) {
    await page
      .waitForRequest((r) => r.url().startsWith(API_ORIGIN) && Boolean(r.headers()['request-signature']), { timeout: IDENTITY_WAIT_MS })
      .catch(() => undefined);
  }
}

async function callApi(page: Page, req: ApiRequest, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  let res: PageFetchResult;
  try {
    res = await pageFetch(page, `${API_ORIGIN}${req.path}`, { method: req.method, headers: req.headers, body: req.body, signal }, timeoutMs);
  } catch (e) {
    if (e instanceof BrowserFetchError && !e.pageClosed) {
      // CloudFront's refusals (WAF, bad signature) come without CORS headers.
      throw new BlockedError(`${API_HOST}: request refused before any response (WAF or request signature) — ${e.message}`);
    }
    throw e;
  }
  if (res.status === 429) throw new RateLimitedError(`${API_HOST}: HTTP 429 (rate limited)`);
  assertPageResponseNotBlocked(res, API_HOST);
  if (res.status !== 200) throw new UpstreamError(`${API_HOST}: HTTP ${res.status} ${res.text.slice(0, 120)}`, res.status);
  const json = safeJson(res.text);
  if (json === undefined) throw new UpstreamError(`${API_HOST}: expected JSON, got ${res.text.slice(0, 60)}`);
  return json;
}

async function requestInput(page: Page, store: Pick<ZeptoStoreContext, 'storeIds' | 'storeEtas'>): Promise<RequestInput> {
  return {
    jar: await cookieJar(page.context(), SITE_ORIGIN),
    identity: states.get(page)?.identity ?? {},
    store,
    requestId: randomUUID(),
  };
}

function storeIdsOf(stores: ZeptoStores): string[] {
  return [stores.primaryId, stores.secondaryId].filter((id): id is string => Boolean(id));
}

/**
 * Zepto's store assignment for this point *now*: the site's own home-layout
 * call. The assignment rotates within minutes, so the serviceability cookie
 * from when the session opened is only the fallback, used when that call
 * fails for a reason other than a block or a timeout.
 */
async function currentStores(page: Page, loc: { lat: number; lng: number }, ctx: AdapterContext): Promise<ZeptoStores> {
  const jar = await cookieJar(page.context(), SITE_ORIGIN);
  let sessionStores: ZeptoStores | null = null;
  try {
    sessionStores = parseServiceability(jar[COOKIE.serviceability]);
  } catch {
    // No usable cookie; get_page alone decides.
  }
  // Like the site, name the stores the session already has (none if it has none).
  const headerStores = sessionStores?.serviceable ? { storeIds: storeIdsOf(sessionStores), storeEtas: sessionStores.etas } : { storeIds: [], storeEtas: {} };
  const q = new URLSearchParams({ latitude: String(loc.lat), longitude: String(loc.lng), ...STORE_PAGE_PARAMS }).toString();
  try {
    const req = signedRequest('GET', `${STORE_PAGE_PATH}?${q}`, undefined, await requestInput(page, headerStores));
    return parseStorePage(await callApi(page, req, STORE_TIMEOUT_MS, ctx.signal));
  } catch (e) {
    if (e instanceof BlockedError || e instanceof TimeoutError || !sessionStores) throw e;
    ctx.log(`home layout lookup failed (${(e as Error).message}); using the session's serviceability cookie`);
    return sessionStores;
  }
}

/** The area name ("Koramangala") from the site's reverse geocoder; null when it cannot say. */
async function areaName(page: Page, loc: { lat: number; lng: number }, store: ZeptoStoreContext, ctx: AdapterContext): Promise<string | null> {
  try {
    const q = new URLSearchParams({ latitude: String(loc.lat), longitude: String(loc.lng) }).toString();
    const req = signedRequest('GET', `${AREA_PATH}?${q}`, undefined, await requestInput(page, store));
    return asString(pluck(await callApi(page, req, AREA_TIMEOUT_MS, ctx.signal), [AREA_LABEL_KEY]));
  } catch (e) {
    // A nicety: a failure here must not cost the platform.
    ctx.log(`area name lookup failed: ${(e as Error).message}`);
    return null;
  }
}

// --- Adapter -----------------------------------------------------------------------

async function resolveStore(location: GeoLocation, ctx: AdapterContext): Promise<ResolvedStore | null> {
  const loc = { lat: location.lat, lng: location.lng };
  const opts = sessionOptions(loc, ctx.signal);
  return withSession(opts, async (page) => {
    const stores = await currentStores(page, loc, ctx);
    if (!stores.serviceable || !stores.primaryId) {
      // Nothing will be searched here; don't hold a page open for it.
      await dropSession(opts.key, page);
      return null;
    }
    const context: ZeptoStoreContext = { ...loc, storeIds: storeIdsOf(stores), storeEtas: stores.etas };
    const state = states.get(page);
    const label = state && state.areaLabel !== undefined ? state.areaLabel : await areaName(page, loc, context, ctx);
    if (state) state.areaLabel = label;

    const etaMinutes = stores.etas[stores.primaryId];
    return {
      storeId: stores.primaryId,
      label: label ?? stores.city,
      eta: stores.etaText ?? (etaMinutes !== undefined ? `${etaMinutes} minutes` : null),
      context: { ...context },
    };
  });
}

async function search(query: string, store: ResolvedStore, ctx: AdapterContext): Promise<Listing[]> {
  const c = readStoreContext(store);
  const text = query.trim();
  if (text === '') return [];
  return withSession(sessionOptions(c, ctx.signal), async (page) => {
    const req = buildSearchRequest(text, { ...(await requestInput(page, c)), intentId: randomUUID() });
    const json = await callApi(page, req, SEARCH_TIMEOUT_MS, ctx.signal);
    return parseSearchResponse(json, { storeIds: c.storeIds, fetchedAt: new Date().toISOString() });
  });
}

const adapter: PlatformAdapter = {
  id: 'zepto',
  transport: 'browser',
  resolveStore,
  search,
};

export default adapter;
