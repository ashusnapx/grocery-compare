/**
 * Swiggy Instamart — quick-commerce adapter over Instamart's own web APIs,
 * through the `browser` transport (a real Chromium page on www.swiggy.com).
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE — probed live on 2026-09-27 from a residential IP in Bengaluru
 * (spike S2, docs/research/2026-09-27-spike-s2-zepto-instamart.md). Read this
 * before trusting a row.
 *
 * VERIFIED LIVE (2026-09-27):
 *   - www.swiggy.com/instamart answers a first visit with AWS WAF's 202 +
 *     `x-amzn-waf-action: challenge`; in Chromium the challenge script earns an
 *     `aws-waf-token` cookie (on .www.swiggy.com, 4-day expiry) and reloads
 *     into the real site. Headless works with the transport's UA fix.
 *   - Location: POST /api/instamart/home/select-location/v2 {data:{lat, lng,
 *     address, addressId, annotation, clientId:"INSTAMART-APP"}} — the site's
 *     own location API — called from inside the page. It sets the
 *     `userLocation` cookie and answers with the pods (dark stores), layoutId
 *     and SLA under data.configs.IM_PAGE_CONFIGS / IM_TOOL_BAR. Bengaluru
 *     12.9352,77.6245 → pod 1396284; Mumbai 19.1364,72.8296 → pod 1398452.
 *     An unserviceable point answers statusCode 0 with empty configs and
 *     data.communication.swiggyNotPresent.swiggyNotPresent = true.
 *   - Search: POST /api/instamart/search/v2?offset=0&ageConsent=false
 *     &layoutId=…&voiceSearchTrackingId=&storeId=…&primaryStoreId=…
 *     &secondaryStoreId=… with body {facets:[], sortAttribute:"", query,
 *     search_results_offset:"0", page_type:"INSTAMART_AUTO_SUGGEST_PAGE",
 *     is_pre_search_tag:false} — exactly what the site sends when Enter is
 *     pressed in its search box. The site also sends `x-build-version`,
 *     `x-device-id` and an obfuscated `matcher` header; the search answers
 *     200 without any of them today. We send the first two, not `matcher`.
 *   - The response is Swiggy's widget soup, camelCase (NOT the snake_case
 *     med-compare assumed): cards[].card.card of type GridWidget (results,
 *     under gridElements.infoWithStyle.items) and OOSItemCollectionCard
 *     ("Few Items are currently sold out", under items.items). Each item is a
 *     product group (displayName, brand, productId, variations[]); each
 *     variation is one pack (skuId, spinId, quantityDescription, price,
 *     inventory.inStock, podId, category).
 *   - Money is {currencyCode:"INR", units:"252", nanos:0}: rupees + nanos. The
 *     page showed "SOLD OUT · Amul Pasteurised Butter · 100 g x 4 · ₹252" for
 *     offerPrice.units "252", inventory.inStock false.
 *   - Each item's analytics.extraFields.searchResultType is HIGH_CONFIDENCE
 *     for real matches and LOW_CONFIDENCE for "related" fillers (for "amul
 *     butter": NOICE pav, paneer, buttermilk). Confident items come first.
 *   - Every variation carries the podId it is priced at; the location check
 *     reads that.
 *   - PDP links are https://www.swiggy.com/instamart/item/<productId> (the
 *     group's productId), read off a click on the site's own result card.
 *   - The empty cart the site loads after a location is set says
 *     "<b>FREE DELIVERY</b> on orders above ₹199" (comms.nudgeComms) — the one
 *     fee fact an anonymous visitor is shown (Bengaluru and Mumbai alike). It
 *     only appears once the page has reloaded with the location, which setup
 *     does; the same call without the reload answers data: null.
 *     Re-checked 2026-09-29 (docs/research/2026-09-29-live-fees.md): same
 *     nudge; brand offers now ride along under comms.couponlessOffersComms
 *     ("… worth above ₹499") and are not fees. Nothing the site loads for a
 *     guest (select-location, home/v2, im-footer, the empty cart) states the
 *     delivery fee amount, a handling, small-cart or surge fee. The hint is
 *     read once per browser session (≤ 30 min old).
 *   - Swiggy rate-limits with HTTP 200 + {"statusCode":429} (seen once, after
 *     a burst of location calls). callJson backs off 1.5 s and retries once,
 *     then reports blocked (RateLimitedError) without recycling the session.
 *   - Pods and SLAs can move within minutes, so resolveStore re-asks
 *     select-location whenever the session's answer is over a minute old.
 *   - Spike S2 (headless, residential IP): 10/10 searches priced, 470–700 ms
 *     each warm; a cold session (launch + challenge + location + reload)
 *     ~5 s. A session page stayed valid across idle gaps (see the spike note).
 *
 * ASSUMPTIONS (not verified):
 *   - offerPrice is what a logged-out visitor pays (it is what the card
 *     shows); maxSaverPrice / salePrice / flashSalePriceDetails are ignored.
 *   - spinId identifies the pack as sold (the cart speaks of "spins"); skuId is
 *     the fallback listingId.
 *   - `matcher` stays optional. If searches start failing with an UpstreamError
 *     or BlockedError while the site still works, it is the first suspect.
 *
 * MAINTAINER, WHEN THIS BREAKS, IN ORDER:
 *   1. BlockedError at setup: the WAF refused the browser (transports/browser.ts).
 *   2. UpstreamError "no page config": select-location changed shape — re-read
 *      data.configs.IM_PAGE_CONFIGS.configInfo[0].card.
 *   3. 200 but no rows: the card @type suffixes and ITEM / VARIATION paths.
 *   4. Rows refused for a foreign pod: Swiggy moved the area to another pod;
 *      the fetcher re-resolves the store after its cache expires.
 * ---------------------------------------------------------------------------
 */
import type { BrowserContext, Page, Request, Response } from 'playwright';
import type { FeeHints, GeoLocation, Listing } from '@gc/engine';
import { BlockedError, UpstreamError } from '../errors';
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

const SITE_HOST = 'www.swiggy.com';
const SITE_ORIGIN = `https://${SITE_HOST}`;
const SITE_HOME = `${SITE_ORIGIN}/instamart`;
const SELECT_LOCATION_PATH = '/api/instamart/home/select-location/v2';
const SEARCH_PATH = '/api/instamart/search/v2';
/** The empty cart the home page loads; carries the free-delivery nudge. */
const CART_PATH = '/api/instamart/checkout/v2/cart';
const API_PREFIX = '/api/instamart/';
const PRODUCT_PATH = (productId: string) => `/instamart/item/${encodeURIComponent(productId)}`;
/** Cloudinary transform the site uses, sized to 400 px (verified to resolve). */
const IMAGE_BASE = 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_400/';

// --- Request shape -------------------------------------------------------------

/** The client the web app names itself as in select-location. */
const LOCATION_CLIENT_ID = 'INSTAMART-APP';
/** page_type the search box sends on Enter. */
const SEARCH_PAGE_TYPE = 'INSTAMART_AUTO_SUGGEST_PAGE';
const COOKIE_DEVICE_ID = 'deviceId';
/** Set by the real page, not the challenge page; their presence means the site is up. */
const READY_COOKIES = [COOKIE_DEVICE_ID, 'tid', 'sid'];
const BUILD_VERSION_HEADER = 'x-build-version';
const FALLBACK_BUILD_VERSION = '2.379.0';

// --- Limits -------------------------------------------------------------------

const MAX_LISTINGS = 20;
/** Swiggy's in-body rate-limit code, and how long to back off before the one retry. */
const RATE_LIMITED_STATUS = 429;
const RATE_LIMIT_BACKOFF_MS = 1_500;
const SEARCH_TIMEOUT_MS = 8_000;
const LOCATION_TIMEOUT_MS = 8_000;
/** A session's select-location answer younger than this is reused by resolveStore. */
const LOCATION_FRESH_MS = 60_000;
const SETUP_TIMEOUT_MS = 25_000;
/** After the reload, how long setup waits for the site's own cart call (fee hint). */
const CART_WAIT_MS = 5_000;

// --- Response shape ------------------------------------------------------------

const ENVELOPE = { status: 'statusCode', data: 'data', message: 'statusMessage', ok: 0 } as const;

const LOCATION = {
  pageConfigCard: ['configs', 'IM_PAGE_CONFIGS', 'configInfo', '0', 'card'],
  toolbarSla: ['configs', 'IM_TOOL_BAR', 'configInfo', '0', 'card', 'sla'],
  notPresent: ['communication', 'swiggyNotPresent', 'swiggyNotPresent'],
  serviceability: 'serviceabilityStatus',
  serviceable: 'SERVICEABLE',
  layoutId: 'layoutId',
  pods: 'podDetailsList',
  podFallback: 'podDetails',
  podId: 'podId',
  priority: 'priority',
  primary: 'PRIORITY_PRIMARY',
  podSla: ['serviceabilityDetails', 'sla'],
  slaValue: 'value',
  slaUnit: 'unit',
} as const;

const SEARCH = {
  cards: ['cards'],
  card: ['card', 'card'],
  type: '@type',
  gridType: '.GridWidget',
  gridItems: ['gridElements', 'infoWithStyle', 'items'],
  soldOutType: '.OOSItemCollectionCard',
  soldOutItems: ['items', 'items'],
} as const;

const ITEM = {
  productId: 'productId',
  title: 'displayName',
  brand: 'brand',
  inStock: 'inStock',
  variations: 'variations',
  resultType: ['analytics', 'extraFields', 'searchResultType'],
  lowConfidence: 'LOW_CONFIDENCE',
} as const;

const VARIATION = {
  id: 'spinId',
  idFallback: 'skuId',
  title: 'displayName',
  brand: 'brandName',
  quantityText: 'quantityDescription',
  offerPrice: ['price', 'offerPrice'],
  mrp: ['price', 'mrp'],
  inStock: ['inventory', 'inStock'],
  podId: 'podId',
  imageIds: 'imageIds',
  category: 'category',
} as const;

const MONEY = { units: 'units', nanos: 'nanos', nanosPerUnit: 1e9 } as const;

/** Catalogue placeholders Swiggy puts in `brand` for loose produce ("Onion (Eerulli)"); not brands. */
const PLACEHOLDER_BRANDS = new Set(['fruits & vegetables category', 'fruits and vegetables', 'unbranded']);

const CART = { nudgeText: ['data', 'data', 'comms', 'nudgeComms', 'success', 'text'] } as const;
const FREE_DELIVERY_RE = /free\s+delivery.*?above\s*₹\s*([\d,]+)/i;

// --- JSON readers ----------------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Walks objects and arrays; numeric segments index arrays. */
function pluck(root: unknown, path: readonly string[]): unknown {
  let node = root;
  for (const key of path) {
    if (Array.isArray(node)) node = node[Number(key)];
    else if (isObject(node)) node = node[key];
    else return undefined;
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

/** {units:"252", nanos:500000000} → 252.5. */
export function money(v: unknown): number | null {
  if (!isObject(v)) return null;
  const units = asNumber(v[MONEY.units]);
  if (units === null) return null;
  const nanos = asNumber(v[MONEY.nanos]) ?? 0;
  return Math.round((units + nanos / MONEY.nanosPerUnit) * 100) / 100;
}

/** Unwraps {statusCode, data}; a non-zero statusCode is Swiggy refusing, with its reason. */
function unwrap(json: unknown, what: string): Json {
  if (!isObject(json)) throw new UpstreamError(`instamart: ${what} answered something that is not an object`);
  const status = asNumber(json[ENVELOPE.status]);
  const data = json[ENVELOPE.data];
  if (status !== null && status !== ENVELOPE.ok) {
    const message = asString(pluck(data, [ENVELOPE.message])) ?? asString(json[ENVELOPE.message]) ?? JSON.stringify(json).slice(0, 160);
    throw new UpstreamError(`instamart: ${what} refused (${status}): ${message}`);
  }
  if (!isObject(data)) throw new UpstreamError(`instamart: ${what} has no data`);
  return data;
}

// --- Location ----------------------------------------------------------------------

export interface InstamartLocation {
  serviceable: boolean;
  /** Swiggy's reason when not serviceable, for logs. */
  status: string | null;
  primaryPodId: string | null;
  secondaryPodId: string | null;
  layoutId: string | null;
  /** As the toolbar phrases it, e.g. "7 Mins". */
  eta: string | null;
}

/** Reads a select-location/v2 answer. */
export function parseSelectLocation(json: unknown): InstamartLocation {
  const data = unwrap(json, 'select-location');
  if (pluck(data, LOCATION.notPresent) === true) {
    return { serviceable: false, status: 'SWIGGY_NOT_PRESENT', primaryPodId: null, secondaryPodId: null, layoutId: null, eta: null };
  }
  const card = pluck(data, LOCATION.pageConfigCard);
  if (!isObject(card)) throw new UpstreamError('instamart: select-location returned no page config');

  let primary: string | null = null;
  let secondary: string | null = null;
  let podSla: unknown;
  const pods = card[LOCATION.pods];
  if (Array.isArray(pods)) {
    for (const pod of pods) {
      const id = asString(pluck(pod, [LOCATION.podId]));
      if (!id) continue;
      if (pluck(pod, [LOCATION.priority]) === LOCATION.primary && !primary) {
        primary = id;
        podSla = pluck(pod, LOCATION.podSla);
      } else if (!secondary && id !== primary) {
        secondary = id;
      }
    }
  }
  primary ??= asString(pluck(card, [LOCATION.podFallback, LOCATION.podId]));
  if (secondary === primary) secondary = null;

  const status = asString(card[LOCATION.serviceability]);
  const sla = pluck(data, LOCATION.toolbarSla) ?? podSla;
  const slaValue = asString(pluck(sla, [LOCATION.slaValue]));
  const slaUnit = asString(pluck(sla, [LOCATION.slaUnit]));
  const layoutId = asNumber(card[LOCATION.layoutId]);
  return {
    serviceable: status === LOCATION.serviceable && primary !== null,
    status,
    primaryPodId: primary,
    secondaryPodId: secondary,
    layoutId: layoutId === null ? null : String(layoutId),
    eta: slaValue ? `${slaValue} ${slaUnit ?? 'mins'}` : null,
  };
}

/** The free-delivery threshold the empty cart announces, if it does. */
export function parseCartFeeHints(json: unknown): FeeHints | undefined {
  const text = asString(pluck(json, CART.nudgeText));
  if (!text) return undefined;
  const plain = text.replace(/<[^>]+>/g, '');
  const m = FREE_DELIVERY_RE.exec(plain);
  if (!m) return undefined;
  const threshold = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(threshold) && threshold > 0 ? { freeDeliveryAbove: threshold } : undefined;
}

/** What search needs from resolveStore; kept in ResolvedStore.context. */
export interface InstamartStoreContext {
  lat: number;
  lng: number;
  primaryPodId: string;
  secondaryPodId: string | null;
  layoutId: string | null;
}

function readStoreContext(store: ResolvedStore): InstamartStoreContext {
  const c = store.context as Partial<InstamartStoreContext>;
  if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || typeof c.primaryPodId !== 'string') {
    throw new UpstreamError('instamart: store context is missing its location or pod');
  }
  return { lat: c.lat, lng: c.lng, primaryPodId: c.primaryPodId, secondaryPodId: c.secondaryPodId ?? null, layoutId: c.layoutId ?? null };
}

// --- Search -------------------------------------------------------------------------

export function buildSearchUrl(c: Pick<InstamartStoreContext, 'primaryPodId' | 'secondaryPodId' | 'layoutId'>): string {
  const params = new URLSearchParams({
    offset: '0',
    ageConsent: 'false',
    ...(c.layoutId ? { layoutId: c.layoutId } : {}),
    voiceSearchTrackingId: '',
    storeId: c.primaryPodId,
    primaryStoreId: c.primaryPodId,
    secondaryStoreId: c.secondaryPodId ?? '',
  });
  return `${SEARCH_PATH}?${params.toString()}`;
}

export function buildSearchBody(query: string): string {
  return JSON.stringify({
    facets: [],
    sortAttribute: '',
    query,
    search_results_offset: '0',
    page_type: SEARCH_PAGE_TYPE,
    is_pre_search_tag: false,
  });
}

export interface ParseOptions {
  /** Pods the request named; rows priced at any other pod are refused. */
  podIds: readonly string[];
  fetchedAt: string;
  limit?: number;
}

function brandOf(variation: Json, item: Json): string | null {
  const brand = asString(variation[VARIATION.brand]) ?? asString(item[ITEM.brand]);
  return brand && !PLACEHOLDER_BRANDS.has(brand.toLowerCase()) ? brand : null;
}

function imageUrlOf(variation: Json): string | null {
  const ids = variation[VARIATION.imageIds];
  const first = Array.isArray(ids) ? asString(ids[0]) : null;
  if (!first) return null;
  return /^https?:\/\//i.test(first) ? first : `${IMAGE_BASE}${first.replace(/^\/+/, '')}`;
}

/**
 * Listings from one search response: one per pack (variation), confident
 * matches first in the site's order, then low-confidence fillers, capped at
 * `limit`. Throws UpstreamError when any pack is priced at a pod the request
 * did not name, or when no pack says which pod it is priced at.
 */
export function parseSearchResponse(json: unknown, opts: ParseOptions): Listing[] {
  const data = unwrap(json, 'search');
  const cards = pluck(data, SEARCH.cards);
  if (!Array.isArray(cards)) throw new UpstreamError('instamart: search response has no cards');

  const confident: Json[] = [];
  const fillers: Json[] = [];
  for (const wrapper of cards) {
    const card = pluck(wrapper, SEARCH.card);
    const type = asString(pluck(card, [SEARCH.type])) ?? '';
    const items = type.endsWith(SEARCH.gridType)
      ? pluck(card, SEARCH.gridItems)
      : type.endsWith(SEARCH.soldOutType)
        ? pluck(card, SEARCH.soldOutItems)
        : undefined;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!isObject(item)) continue;
      (pluck(item, ITEM.resultType) === ITEM.lowConfidence ? fillers : confident).push(item);
    }
  }

  const limit = opts.limit ?? MAX_LISTINGS;
  const listings: Listing[] = [];
  const seen = new Set<string>();
  const foreign = new Set<string>();
  let packs = 0;
  let unplaced = 0;
  for (const item of [...confident, ...fillers]) {
    const productId = asString(item[ITEM.productId]);
    const variations = item[ITEM.variations];
    if (!productId || !Array.isArray(variations)) continue;
    for (const v of variations) {
      if (!isObject(v)) continue;
      packs++;
      const podId = asString(v[VARIATION.podId]);
      if (!podId) {
        unplaced++;
        continue;
      }
      if (!opts.podIds.includes(podId)) {
        foreign.add(podId);
        continue;
      }
      const listingId = asString(v[VARIATION.id]) ?? asString(v[VARIATION.idFallback]);
      const title = asString(v[VARIATION.title]) ?? asString(item[ITEM.title]);
      const price = money(pluck(v, VARIATION.offerPrice));
      // No id, no name or no positive price: nothing we could show honestly.
      if (!listingId || !title || price === null || price <= 0 || seen.has(listingId)) continue;
      seen.add(listingId);
      const mrp = money(pluck(v, VARIATION.mrp));
      const stock = pluck(v, VARIATION.inStock);
      if (listings.length >= limit) continue; // keep counting pods: a foreign one anywhere still refuses the page
      listings.push({
        platformId: 'instamart',
        listingId,
        title,
        brand: brandOf(v, item),
        quantityText: asString(v[VARIATION.quantityText]) ?? '',
        price,
        // An MRP below the price means the fields changed meaning; show none.
        mrp: mrp !== null && mrp >= price ? mrp : null,
        inStock: typeof stock === 'boolean' ? stock : item[ITEM.inStock] !== false,
        productUrl: `${SITE_ORIGIN}${PRODUCT_PATH(productId)}`,
        imageUrl: imageUrlOf(v),
        category: asString(v[VARIATION.category]),
        fetchedAt: opts.fetchedAt,
      });
    }
  }
  if (foreign.size > 0) {
    throw new UpstreamError(`instamart: results priced at pod ${[...foreign].join(', ')}, not the requested ${opts.podIds.join(', ')}`);
  }
  if (packs > 0 && unplaced === packs) {
    throw new UpstreamError('instamart: search rows no longer say which pod they are priced at');
  }
  return listings;
}

// --- Session -----------------------------------------------------------------------

interface SessionState {
  location: InstamartLocation;
  /** When `location` was last asked of the platform. */
  locatedAt: number;
  feeHints: FeeHints | undefined;
  buildVersion: string | null;
}

function locationBody(loc: { lat: number; lng: number }): string {
  return JSON.stringify({ data: { lat: loc.lat, lng: loc.lng, address: '', addressId: '', annotation: '', clientId: LOCATION_CLIENT_ID } });
}

const states = new WeakMap<Page, SessionState>();

function sessionOptions(loc: { lat: number; lng: number }, signal?: AbortSignal): SessionOptions {
  return {
    // Same ~110 m cell as the fetcher's store cache.
    key: `instamart:${loc.lat.toFixed(3)},${loc.lng.toFixed(3)}`,
    geolocation: { latitude: loc.lat, longitude: loc.lng },
    signal,
    setup: (page, context) => setupSession(page, context, loc),
  };
}

interface CallInit {
  body?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

async function callOnce(page: Page, method: 'GET' | 'POST', path: string, init: CallInit): Promise<unknown> {
  let res: PageFetchResult;
  try {
    res = await pageFetch(
      page,
      `${SITE_ORIGIN}${path}`,
      { method, body: init.body, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers }, signal: init.signal },
      init.timeoutMs,
    );
  } catch (e) {
    if (e instanceof BrowserFetchError && !e.pageClosed) throw new BlockedError(`${SITE_HOST}: request refused before any response — ${e.message}`);
    throw e;
  }
  if (res.status === 429) throw new RateLimitedError(`${SITE_HOST}: HTTP 429 (rate limited)`);
  assertPageResponseNotBlocked(res, SITE_HOST);
  if (res.status !== 200) throw new UpstreamError(`${SITE_HOST}: HTTP ${res.status} ${res.text.slice(0, 120)}`, res.status);
  try {
    return JSON.parse(res.text) as unknown;
  } catch {
    throw new UpstreamError(`${SITE_HOST}: expected JSON, got ${res.text.slice(0, 60)}`);
  }
}

/** True for Swiggy's in-body rate limit: HTTP 200 carrying {"statusCode":429}. */
export function isRateLimited(json: unknown): boolean {
  return isObject(json) && asNumber(json[ENVELOPE.status]) === RATE_LIMITED_STATUS;
}

/**
 * One API call from inside the page. Swiggy signals a rate limit as HTTP 200
 * with statusCode 429 in the body (seen 2026-09-27 after a burst of location
 * calls); that gets one back-off and retry, and is reported as blocked if it
 * persists — never as "no results".
 */
async function callJson(page: Page, method: 'GET' | 'POST', path: string, init: CallInit): Promise<unknown> {
  const first = await callOnce(page, method, path, init);
  if (!isRateLimited(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS));
  if (init.signal?.aborted) throw new RateLimitedError(`${SITE_HOST}: rate limited (in-body 429)`);
  const second = await callOnce(page, method, path, init);
  if (isRateLimited(second)) throw new RateLimitedError(`${SITE_HOST}: rate limited (in-body 429, persisted after ${RATE_LIMIT_BACKOFF_MS} ms)`);
  return second;
}

/**
 * Opens Instamart as a visitor would, lets the WAF challenge run, sets the
 * location through the site's own API, and reloads so the page (and its cart,
 * which carries the free-delivery nudge) is for that location.
 */
async function setupSession(page: Page, context: BrowserContext, loc: { lat: number; lng: number }): Promise<void> {
  let buildVersion: string | null = null;
  let cartJson: unknown;
  let reloaded = false;
  page.on('request', (req: Request) => {
    if (!req.url().startsWith(`${SITE_ORIGIN}${API_PREFIX}`)) return;
    buildVersion = req.headers()[BUILD_VERSION_HEADER] ?? buildVersion;
  });
  // The first cart the page loads *after* the location reload, nudge or not.
  const cartSeen = new Promise<void>((resolve) => {
    const onCart = (res: Response) => {
      if (!reloaded || !res.url().startsWith(`${SITE_ORIGIN}${CART_PATH}`) || res.status() !== 200) return;
      page.off('response', onCart);
      res
        .json()
        .then((j: unknown) => {
          cartJson = j;
        })
        .catch(() => undefined)
        .finally(resolve);
    };
    page.on('response', onCart);
  });

  const ready = async () => {
    const jar = await cookieJar(context, SITE_ORIGIN);
    return READY_COOKIES.every((name) => jar[name]);
  };
  await openThroughChallenge(page, SITE_HOME, { timeoutMs: SETUP_TIMEOUT_MS, ready });

  const location = parseSelectLocation(await callJson(page, 'POST', SELECT_LOCATION_PATH, { body: locationBody(loc), timeoutMs: LOCATION_TIMEOUT_MS }));
  const locatedAt = Date.now();
  if (location.serviceable) {
    reloaded = true;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: SETUP_TIMEOUT_MS });
    await Promise.race([cartSeen, new Promise((resolve) => setTimeout(resolve, CART_WAIT_MS))]);
  }
  states.set(page, {
    location,
    locatedAt,
    feeHints: parseCartFeeHints(cartJson),
    get buildVersion() {
      return buildVersion;
    },
  });
}

// --- Adapter -----------------------------------------------------------------------

async function resolveStore(location: GeoLocation, ctx: AdapterContext): Promise<ResolvedStore | null> {
  const loc = { lat: location.lat, lng: location.lng };
  const opts = sessionOptions(loc, ctx.signal);
  return withSession(opts, async (page) => {
    const state = states.get(page);
    if (!state) throw new UpstreamError('instamart: session has no location state');
    // Pods and SLAs move within minutes; re-ask unless the session just did.
    if (Date.now() - state.locatedAt > LOCATION_FRESH_MS) {
      state.location = parseSelectLocation(
        await callJson(page, 'POST', SELECT_LOCATION_PATH, { body: locationBody(loc), timeoutMs: LOCATION_TIMEOUT_MS, signal: ctx.signal }),
      );
      state.locatedAt = Date.now();
    }
    const l = state.location;
    if (!l.serviceable || !l.primaryPodId) {
      ctx.log(`not serviceable here (${l.status ?? 'no status'})`);
      // Nothing will be searched here; don't hold a page open for it.
      await dropSession(opts.key, page);
      return null;
    }
    const context: InstamartStoreContext = { ...loc, primaryPodId: l.primaryPodId, secondaryPodId: l.secondaryPodId, layoutId: l.layoutId };
    return {
      storeId: l.primaryPodId,
      // select-location names no area, and the site loads no geocoder we could ask.
      label: null,
      eta: l.eta,
      feeHints: state.feeHints,
      context: { ...context },
    };
  });
}

async function search(query: string, store: ResolvedStore, ctx: AdapterContext): Promise<Listing[]> {
  const c = readStoreContext(store);
  const text = query.trim();
  if (text === '') return [];
  return withSession(sessionOptions(c, ctx.signal), async (page) => {
    const jar = await cookieJar(page.context(), SITE_ORIGIN);
    const headers: Record<string, string> = { [BUILD_VERSION_HEADER]: states.get(page)?.buildVersion ?? FALLBACK_BUILD_VERSION };
    if (jar[COOKIE_DEVICE_ID]) headers['x-device-id'] = jar[COOKIE_DEVICE_ID];
    const json = await callJson(page, 'POST', buildSearchUrl(c), { body: buildSearchBody(text), headers, timeoutMs: SEARCH_TIMEOUT_MS, signal: ctx.signal });
    const podIds = [c.primaryPodId, c.secondaryPodId].filter((id): id is string => Boolean(id));
    return parseSearchResponse(json, { podIds, fetchedAt: new Date().toISOString() });
  });
}

const adapter: PlatformAdapter = {
  id: 'instamart',
  transport: 'browser',
  resolveStore,
  search,
};

export default adapter;
