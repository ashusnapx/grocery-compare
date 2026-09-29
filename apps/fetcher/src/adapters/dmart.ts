/**
 * DMart Ready (https://www.dmart.in) — slotted grocery delivery, plain HTTP.
 *
 * ---------------------------------------------------------------------------
 * VERIFICATION LOG — probed live on 2026-09-27 from an Indian residential IP
 * (Bengaluru) with a desktop Chrome UA. VERIFIED means seen in a real response
 * that day; ASSUMED is a judgement call a maintainer should retest.
 *
 *  VERIFIED  Store lookup: POST {PINCODE_URL} with JSON {"pincode":"560034"}
 *            (no other field needed) → `storePincodeDetails.storeId`.
 *            560034 → store 10744 (KSRP Block, Bengaluru; home delivery on,
 *            pickup off); 400053 → store 10151 (Andheri (W), Mumbai; both on);
 *            110001 → `isPincodeServiceable: "false"`, "Area Not Serviceable".
 *  VERIFIED  Search: GET {SEARCH_URL}/<term>?page=1&buryOOS=true&size=40
 *            &channel=web, the exact URL the site's `/v3/search/` helper builds,
 *            with the store in a `storeId` REQUEST HEADER.
 *  !!        WITHOUT THAT HEADER DMART STILL ANSWERS 200 WITH PRICES — from an
 *            unknown default store. The probe measured 38 of 40 shared SKUs at
 *            different prices (Healthy Choice Toor Dal 1 kg: ₹180 vs ₹218 at
 *            10744). The response never names the store it priced, so the only
 *            guard is ours: search() refuses to run without a numeric storeId.
 *  VERIFIED  Shape: `products[]` (in stock first) and, with buryOOS=true,
 *            `oosProducts[]` plus `oosPosition` ("5"), where the site renders an
 *            "out of stock" strip. Each product has `sKUs[]` (pack sizes); a SKU
 *            can be out of stock inside an in-stock product (Mumbai "Amul
 *            Butter": 100 g and 500 g in stock, 200 g invStatus "0").
 *  VERIFIED  Prices are rupee STRINGS: `priceSALE` "145.00" payable,
 *            `priceMRP` "192.00". `invStatus` vocabulary from the site bundle:
 *            IN_STOCK "2", OUT_OF_STOCK "0", UNAVAILABLE "-1".
 *  VERIFIED  `manufacturer` is the brand (the site's Brand filter is built on
 *            it: "DMart Premia", "Tata Sampann"). The SKU `name` is the site's
 *            own display name ("DMart Premia Mix Dal : 500 g" — the product
 *            `name` is sometimes brandless: "Mix Dal"), and `variantTextValue`
 *            is the pack text ("1 kg", "10 x 10 g", "1 U").
 *  VERIFIED  Product page: https://www.dmart.in/product/<seo_token_ntk>
 *            ?selectedProd=<skuUniqueID> (the site's PDP route; GET returned
 *            "Buy Amul Butter Online…"). Image:
 *            https://cdn.dmart.in/images/products/<productImageKey>_<imgCode>_P.jpg
 *            (200, image/jpeg).
 *  VERIFIED  A nonsense query returns 200 {"totalRecords":0,"products":[]}.
 *  VERIFIED  robots.txt: www.dmart.in disallows /pdp/ and *?storeId=;
 *            digital.dmart.in has none (404). One search per user query.
 *
 *  ASSUMED   Delivery is slotted and nothing in these responses states a slot,
 *            so eta is the constant SLOT_ETA.
 *  VERIFIED  No per-store fee facts for a guest (2026-09-29,
 *            docs/research/2026-09-29-live-fees.md): the pincode lookup states
 *            none; the checkout family (`/v3/secure/shipmodes/<store>`, slots,
 *            checkout) answers HTTP 401 without login. The only statements are
 *            site-wide CMS strings on www.dmart.in ("Home Delivery : Flat Rs.
 *            49", "Pick Up Point : Free Delivery", "minimum order value of ₹"
 *            followed by a number filled in per cart). A flat, threshold-less
 *            delivery fee has no FeeHints field anyway (deliveryFee needs a
 *            Delivery rule with a threshold), so there are no feeHints; the
 *            catalog's flat ₹49 covers DMart.
 *  ASSUMED   `isHDEnabled: "false"` (pickup-point only) is "not serviceable"
 *            for a delivery comparison.
 *
 * WHEN THIS BREAKS, RE-CHECK IN THIS ORDER:
 *   1. The `storeId` header name (if DMart renames it, every price silently
 *      becomes the default store's — compare one SKU with and without it).
 *   2. PINCODE_URL body/shape (null stores → every city "not serviceable").
 *   3. SKU field names (priceSALE / invStatus / variantTextValue).
 * ---------------------------------------------------------------------------
 */

import type { GeoLocation, Listing } from '@gc/engine';
import { UpstreamError } from '../errors';
import { plainJson } from '../transports/plain';
import type { AdapterContext, PlatformAdapter, ResolvedStore } from './types';

// --- Endpoints & wire constants ----------------------------------------------

export const SITE = 'https://www.dmart.in';
const API = 'https://digital.dmart.in/api';
export const PINCODE_URL = `${API}/v2/pincodes/details`;
export const SEARCH_URL = `${API}/v3/search`;
/** Exactly what www.dmart.in's own search sends (seen 2026-09-29), plus the store as a header. */
const SEARCH_QUERY = 'page=1&buryOOS=true&size=50&channel=web';
const PRODUCT_PATH = '/product/';
const PRODUCT_SKU_PARAM = 'selectedProd';
const IMAGE_BASE = 'https://cdn.dmart.in/images/products/';
const IMAGE_SUFFIX = '_P.jpg';

/** The request header that selects the store. See the "!!" entry above. */
const STORE_HEADER = 'storeId';
/** Same-site headers the browser sends; digital.dmart.in CORS-allows only www. */
const SITE_HEADERS = { origin: SITE, referer: `${SITE}/` };

const TRUE = 'true';
const INV_IN_STOCK = '2';
const SLOT_ETA = 'Slot delivery';
const MAX_LISTINGS = 20;
const PINCODE_RE = /^[1-9]\d{5}$/;
const STORE_ID_RE = /^\d+$/;

// --- Response shapes ------------------------------------------------------------

export interface DmPincodeResponse {
  pincode?: string | null;
  isPincodeServiceable?: string | null;
  storePincodeDetails?: {
    storeId?: string | null;
    isHDEnabled?: string | null;
    isPUPEnabled?: string | null;
    pincode?: string | null;
    region?: string | null;
    area?: string | null;
  } | null;
  unavailableMsg?: string | null;
}

export interface DmSku {
  name?: string | null;
  skuUniqueID?: string | number | null;
  priceSALE?: string | number | null;
  priceMRP?: string | number | null;
  invStatus?: string | null;
  buyable?: string | null;
  variantTextValue?: string | null;
  productImageKey?: string | null;
  imgCode?: string | number | null;
}

export interface DmProduct {
  name?: string | null;
  manufacturer?: string | null;
  seo_token_ntk?: string | null;
  targetUrl?: string | null;
  buyable?: string | null;
  categoryName?: string | null;
  categoryMap?: { level?: string | null; name?: string | null }[] | null;
  sKUs?: DmSku[] | null;
}

export interface DmSearchResponse {
  products?: DmProduct[] | null;
  oosProducts?: DmProduct[] | null;
  oosPosition?: string | number | null;
}

// --- Store lookup ----------------------------------------------------------------

export interface DmStore {
  storeId: string;
  label: string;
}

/**
 * Pure: the pincode lookup → the delivering store, or null when DMart does not
 * home-deliver there. Throws when DMart answers for a different pincode.
 */
export function parsePincodeResponse(json: DmPincodeResponse, pincode: string): DmStore | null {
  if (!json || typeof json !== 'object') throw new UpstreamError('DMart pincode response was not an object');
  if (json.isPincodeServiceable !== TRUE) return null;
  const details = json.storePincodeDetails;
  const storeId = String(details?.storeId ?? '').trim();
  if (!details || !STORE_ID_RE.test(storeId)) return null;
  if (details.isHDEnabled !== TRUE) return null;
  const answered = String(details.pincode ?? json.pincode ?? '').trim();
  if (answered && answered !== pincode) {
    throw new UpstreamError(`DMart answered for pincode ${answered}, not ${pincode}`);
  }
  const place = [details.area?.trim(), details.region?.trim()].filter(Boolean).join(', ');
  return { storeId, label: place ? `DMart Ready ${place}` : `DMart store ${storeId}` };
}

// --- Search parsing --------------------------------------------------------------

function toRupees(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The site's order: in-stock products, with the OOS strip at `oosPosition`. */
function inSiteOrder(json: DmSearchResponse): DmProduct[] {
  const products = json.products ?? [];
  const oos = Array.isArray(json.oosProducts) ? json.oosProducts : [];
  const pos = Number.parseInt(String(json.oosPosition ?? ''), 10);
  const at = Number.isFinite(pos) && pos >= 0 ? Math.min(pos, products.length) : products.length;
  return [...products.slice(0, at), ...oos, ...products.slice(at)];
}

function categoryOf(product: DmProduct): string | null {
  const levels = (product.categoryMap ?? []).filter((c) => c?.name?.trim());
  const deepest = levels.sort((a, b) => String(b.level ?? '').localeCompare(String(a.level ?? '')))[0];
  return deepest?.name?.trim() || product.categoryName?.trim() || null;
}

function productUrlOf(product: DmProduct, skuId: string): string | null {
  const token = product.seo_token_ntk?.trim();
  if (token) return `${SITE}${PRODUCT_PATH}${encodeURIComponent(token)}?${PRODUCT_SKU_PARAM}=${encodeURIComponent(skuId)}`;
  const target = product.targetUrl?.trim();
  return target ? new URL(target, SITE).toString() : null;
}

function imageUrlOf(sku: DmSku): string | null {
  const key = sku.productImageKey?.trim();
  const code = String(sku.imgCode ?? '').trim();
  return key && code ? `${IMAGE_BASE}${key}_${code}${IMAGE_SUFFIX}` : null;
}

function toListing(product: DmProduct, sku: DmSku, fetchedAt: string): Listing | null {
  const skuId = String(sku.skuUniqueID ?? '').trim();
  const price = toRupees(sku.priceSALE);
  const title = sku.name?.trim() || product.name?.trim() || '';
  const url = skuId ? productUrlOf(product, skuId) : null;
  if (!skuId || price === null || !title || !url) return null;
  const marked = toRupees(sku.priceMRP);
  return {
    platformId: 'dmart',
    listingId: skuId,
    title,
    brand: product.manufacturer?.trim() || null,
    quantityText: sku.variantTextValue?.trim() ?? '',
    price,
    mrp: marked !== null && marked >= price ? marked : null,
    inStock: sku.invStatus === INV_IN_STOCK && sku.buyable !== 'false' && product.buyable !== 'false',
    productUrl: url,
    imageUrl: imageUrlOf(sku),
    category: categoryOf(product),
    fetchedAt,
  };
}

/**
 * Pure: a search response → listings, one per SKU, in the site's order. Whole
 * products are kept together (a pack-size ladder is only useful complete), so
 * the cut at MAX_LISTINGS falls between products.
 */
export function parseSearchResponse(json: DmSearchResponse, fetchedAt = new Date().toISOString()): Listing[] {
  if (!json || !Array.isArray(json.products)) {
    throw new UpstreamError('DMart search response had no products array');
  }
  const listings: Listing[] = [];
  for (const product of inSiteOrder(json)) {
    const rows = (product?.sKUs ?? []).map((sku) => (sku ? toListing(product, sku, fetchedAt) : null)).filter((l): l is Listing => l !== null);
    if (rows.length === 0) continue;
    if (listings.length > 0 && listings.length + rows.length > MAX_LISTINGS) break;
    listings.push(...rows);
  }
  return listings;
}

// --- Adapter -----------------------------------------------------------------------

interface DmContext {
  storeId: string;
  pincode: string;
}

const adapter: PlatformAdapter = {
  id: 'dmart',
  transport: 'plain',

  async resolveStore(location: GeoLocation, ctx: AdapterContext): Promise<ResolvedStore | null> {
    const pincode = location.pincode?.trim() ?? '';
    if (!PINCODE_RE.test(pincode)) throw new Error(`DMart needs a 6-digit pincode, got "${location.pincode}"`);

    const json = await plainJson<DmPincodeResponse>(PINCODE_URL, {
      method: 'POST',
      signal: ctx.signal,
      headers: { ...SITE_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ pincode }),
    });
    const store = parsePincodeResponse(json, pincode);
    if (!store) {
      ctx.log(`no home delivery for this pincode${json?.unavailableMsg ? `: ${json.unavailableMsg}` : ''}`);
      return null;
    }
    const context: DmContext = { storeId: store.storeId, pincode };
    return { storeId: store.storeId, label: store.label, eta: SLOT_ETA, context: { ...context } };
  },

  async search(query: string, store: ResolvedStore, ctx: AdapterContext): Promise<Listing[]> {
    const storeId = String((store.context as Partial<DmContext>).storeId ?? '').trim();
    // Never search without the store: DMart would silently price another city.
    if (!STORE_ID_RE.test(storeId)) {
      throw new UpstreamError('DMart search needs a storeId header; refusing to price the default store');
    }
    const term = query.trim();
    if (!term) return [];

    const url = `${SEARCH_URL}/${encodeURIComponent(term)}?${SEARCH_QUERY}&storeId=${storeId}`;
    const json = await plainJson<DmSearchResponse>(url, {
      signal: ctx.signal,
      headers: { ...SITE_HEADERS, [STORE_HEADER]: storeId },
    });
    return parseSearchResponse(json);
  },
};

export default adapter;
