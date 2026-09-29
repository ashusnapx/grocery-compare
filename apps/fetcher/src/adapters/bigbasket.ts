/**
 * BigBasket BB Now (https://www.bigbasket.com) — quick commerce, plain HTTP.
 *
 * ---------------------------------------------------------------------------
 * VERIFICATION LOG — probed live on 2026-09-27 from an Indian residential IP
 * (Bengaluru) with a desktop Chrome UA; see
 * docs/research/2026-09-27-spike-s3-bigbasket.md. VERIFIED means seen in a real
 * response that day; ASSUMED is a judgement call a maintainer should retest.
 *
 *  VERIFIED  A bare guest session (GET {BOOTSTRAP_PATH}?q=…) is located by the
 *            CALLER'S IP (probe: sa 19224 / fc 1820 for any pincode cookie).
 *            This adapter never searches with such a session.
 *  VERIFIED  How the site itself moves a guest to a chosen place (header
 *            address widget, chunks 3147/6697): Google place → lat/lng →
 *              GET {SERVICEABLE_PATH}?lat&lng&send_all_serviceability=true
 *              PUT {SET_LOCATION_PATH} {lat, long, return_hub_cookies:false,
 *                                       area, contact_zipcode}
 *            with X-Caller UI-KIRK, X-Channel BB-WEB and `X-csurftoken` = the
 *            `csurftoken` cookie (set by the serviceable call, 30 min). The PUT
 *            answers 200 {} and re-issues `_bb_aid`, `_bb_cid`, `_bb_lat_long`.
 *            Then the site calls {HEADER_PATH} and copies its
 *            `additional_cookies` (`_bb_sa_ids`, `_bb_pin_code`, …) into cookies.
 *            locate() replays exactly that; resolveStore() = locate().
 *  VERIFIED  S3 PASSED: same query "amul butter", same minute —
 *              12.9352,77.6245 (Koramangala 560095) → sa_id 18648 / fc 1744
 *              19.1364,72.8296 (Andheri W 400053)   → sa_id 15950 / fc 1478
 *            Different assortments (Nandini/Akshayakalpa/Hatsun vs Parsi Dairy
 *            Farm/President), 6 of 15 shared SKUs with different stock, and a
 *            price difference (Amul Choco Buttery Spread 200 g ₹125 vs ₹120).
 *  VERIFIED  After the PUT the header names the address we asked for (lat, lng,
 *            pin, city) and the BB Now service areas (`_bb_sa_ids` "15950,
 *            17830,31353"; next slot sa 15950 "5 mins"). Every listing row (and
 *            every pack-size child) carries `visibility.sa_id`; the adapter
 *            refuses the response if any row is from an SA outside that set.
 *  VERIFIED  A `_bb_lat_long` cookie alone (no guest session) → 404 "2
 *            exceptions occurred". The full flow is required.
 *  VERIFIED  From med-compare (2026-09-19) and re-seen today: SEARCH_PATH needs
 *            its TRAILING SLASH (without it Akamai 403s); `prim_price.sp` is the
 *            payable price (the site's own mapper reads it), `discount.mrp` the
 *            MRP — both rupee STRINGS, sometimes fractional ("90.48");
 *            `avail_status` "001" = in stock, "000"/"010" = not; `desc` is often
 *            brandless and the card prints `brand.name` above it (TITLE).
 *  VERIFIED  A term that matches nothing now answers HTTP 204 with an EMPTY
 *            body (not the 40-row `is_llm_flow: true` filler med-compare saw on
 *            2026-09-19). 204 → []. The LLM_FALLBACK guard stays for the old
 *            behaviour.
 *  VERIFIED  robots.txt disallows /ps/ (the bootstrap page) but not /ui-svc/,
 *            /member-svc/ or /listing-svc/. One bootstrap per ~110 m cell per
 *            24 h (search.ts caches the store); searches are user-initiated.
 *
 *  ASSUMED   `serviceable_ecs_info.bbnow.serviceable` other than "NA"/"bb1.0"
 *            means BB Now delivers (the site's own rule for picking the entry
 *            context; "bb2.0" seen in both cities).
 *  VERIFIED  2026-09-29: Jaipur 302017 answers with no `bbnow` entry at all
 *            (and `bb-b2c`, scheduled BigBasket, "NA") → null. Lucknow 226010
 *            and Bhagalpur 812001 answered the serviceable call with HTTP 303
 *            {"errors":[{"code":4056,"code_str":"SERVE4056","type":
 *            "SERVICEABILITY ERROR",…}]} (coverage run, ~09:20 IST); the same
 *            Lucknow point answered 200 with bbnow "bb2.0" at 09:31. A
 *            SERVICEABILITY ERROR from the serviceable or set-location step is
 *            BigBasket saying "not here, not now" → null, never an error.
 *  VERIFIED  Scheduled BigBasket (door `bb-b2c`, entry context 100) is a
 *            different service: its own service areas (Lucknow's header
 *            listed sa 35013 "1 hrs" for contexts [15, 100]), slots, and the
 *            slotted fee table (₹50 below ₹600 …), which the engine's catalog
 *            has no entry for. Serving it would mean a second entry context
 *            in locate()/search and a catalog schedule — not done here. It
 *            would not help Jaipur: bb-b2c is "NA" there too.
 *  ASSUMED   A guest session stays valid for the 24 h the store is cached. If
 *            the listing answers with `errors` or a foreign sa_id, search()
 *            re-runs locate() once (at most every RELOCATE_COOLDOWN_MS) and
 *            retries; a second failure is reported as `error`.
 *  VERIFIED  No fee facts a guest can rely on (re-checked 2026-09-29,
 *            docs/research/2026-09-29-live-fees.md): the header's `ticker_info`
 *            and `special_notifications` are empty; the only fee words are the
 *            bbnow door's CMS copy "4500+ essential products. FREE delivery
 *            (limited period)", which contradicts the same header's door UI
 *            ("7000+ essentials") and states no threshold — not read. The
 *            guest basket (/basketService/get/) is empty ({cartInfo:{}}); a
 *            priced basket needs an add-to-basket plus a read and a product
 *            id. So there are no feeHints; the catalog covers BB Now.
 *
 * WHEN THIS BREAKS, RE-CHECK IN THIS ORDER:
 *   1. The trailing slash on SEARCH_PATH (403 → reported as `blocked`).
 *   2. The PUT: body field names, `X-csurftoken`, and that the header call
 *      afterwards reports the requested lat/lng (else resolveStore throws).
 *   3. `visibility.sa_id` still on rows (else every search refuses → `error`).
 *   4. 204-for-no-match and LLM_FALLBACK, if BigBasket rows vanish or junk
 *      appears for nonsense queries.
 * ---------------------------------------------------------------------------
 */

import type { GeoLocation, Listing } from '@gc/engine';
import { UpstreamError } from '../errors';
import { assertJsonBody } from '../transports/detect';
import { plainFetch } from '../transports/plain';
import type { AdapterContext, PlatformAdapter, ResolvedStore } from './types';

// --- Endpoints & wire constants ----------------------------------------------

export const SITE = 'https://www.bigbasket.com';
/** Loaded only to be issued a guest session (see robots note above). */
const BOOTSTRAP_PATH = '/ps/';
const BOOTSTRAP_TERM = 'milk';
const SERVICEABLE_PATH = '/ui-svc/v1/serviceable/';
const SET_LOCATION_PATH = '/member-svc/v2/member/current-delivery-address/';
const HEADER_PATH = '/ui-svc/v2/header';
/** THE TRAILING SLASH IS LOAD-BEARING. */
const SEARCH_PATH = '/listing-svc/v2/products/';
const TYPE_PRODUCT_SEARCH = 'ps';

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
/** The site's COMMONHEADERS for listing/header calls. */
const API_HEADERS: Record<string, string> = {
  'x-caller': 'UIKIRK',
  'x-channel': 'BB-WEB',
  'common-client-static-version': '101',
  'x-requested-with': 'XMLHttpRequest',
};
/** The headers the address widget passes for serviceable / set-location. */
const LOCATION_HEADERS: Record<string, string> = {
  'x-caller': 'UI-KIRK',
  'x-channel': 'BB-WEB',
  'content-type': 'application/json',
  'x-requested-with': 'XMLHttpRequest',
};
/** BB Now's entry context, as the site's `w()` picks it: key bbnow, id 10. */
const BBNOW_KEY = 'bbnow';
const BBNOW_EC_ID = '10';
const ENTRY_CONTEXT_HEADERS: Record<string, string> = {
  'x-entry-context': BBNOW_KEY,
  'x-entry-context-id': BBNOW_EC_ID,
};
/** Cookies the site writes itself after a successful location change (`x()`). */
const ENTRY_CONTEXT_COOKIES: Record<string, string> = {
  xentrycontext: BBNOW_KEY,
  xentrycontextid: BBNOW_EC_ID,
  jentrycontextid: BBNOW_EC_ID,
};
const CSRF_COOKIE = 'csurftoken';
const CSRF_HEADER = 'x-csurftoken';
const VISITOR_COOKIE = '_bb_vid';
const SA_IDS_COOKIE = '_bb_sa_ids';
/** Entry-context serviceability values the site treats as "not here". */
const NOT_SERVICEABLE = new Set(['NA', 'bb1.0']);
/** How BigBasket refuses a place it does not serve: HTTP 303 {"errors":[{type, code_str}]}. */
const SERVICEABILITY_ERROR_TYPE = 'SERVICEABILITY ERROR';
const SERVICEABILITY_ERROR_CODE = 'SERVE4056';
/** The header must place the session within ~50 m of what we asked for. */
const LOCATION_TOLERANCE_DEG = 0.0005;
const RELOCATE_COOLDOWN_MS = 5 * 60 * 1000;
/** `avail_status` "001" is addable to a cart; "000"/"010" are not. */
const AVAIL_IN_STOCK = '001';
/** True when BigBasket had an LLM guess categories for an unmatched term. */
const LLM_FALLBACK_FIELD = 'is_llm_flow';
const MAX_LISTINGS = 20;

// --- Errors ------------------------------------------------------------------------

/**
 * The session no longer answers for the place it was bound to: an `errors`
 * payload, or rows from a service area outside the verified set. search()
 * re-locates once on this; if it persists it surfaces as UpstreamError.
 */
export class SessionProblem extends UpstreamError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = 'SessionProblem';
  }
}

// --- Cookie jar ----------------------------------------------------------------------

/** Replays every cookie, as a browser would; Akamai's live beside the location ones. */
export class CookieJar {
  private readonly jar = new Map<string, string>();

  absorb(res: Response): void {
    const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of lines) this.absorbLine(line);
  }

  absorbLine(line: string): void {
    const [pair, ...attrs] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attrs.some((a) => {
      const [k, v = ''] = a.split('=');
      const key = k.trim().toLowerCase();
      if (key === 'max-age') return Number(v) <= 0;
      if (key === 'expires') return Date.parse(v) < Date.now();
      return false;
    });
    if (expired) this.jar.delete(name);
    else if (name) this.jar.set(name, value);
  }

  set(name: string, value: string): void {
    this.jar.set(name, value);
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

// --- Response shapes (only what we read) -------------------------------------------

export interface BbServiceable {
  serviceable_ecs_info?: Record<string, { serviceable?: string | null } | null> | null;
  places_info?: { area?: string | null; pincode?: string | null; city?: string | null } | null;
}

export interface BbHeader {
  selected_address_id?: string | number | null;
  addresses?: {
    id?: string | number | null;
    lat?: number | string | null;
    lng?: number | string | null;
    pin?: number | string | null;
    area?: string | null;
    city_name?: string | null;
  }[] | null;
  sa_list?: { sa_id?: number | null; eta?: string | null }[] | null;
  additional_cookies?: Record<string, unknown> | null;
  next_available_slots?: { sa_id?: number | null; short_eta?: string | null; eta_message?: string | null }[] | null;
}

interface BbImage {
  l?: string | null;
  m?: string | null;
  s?: string | null;
}

export interface BbProduct {
  id?: string | number | null;
  desc?: string | null;
  brand?: { name?: string | null } | null;
  w?: string | null;
  absolute_url?: string | null;
  category?: { llc_name?: string | null; mlc_name?: string | null } | null;
  availability?: { avail_status?: string | null; not_for_sale?: boolean | null } | null;
  pricing?: { discount?: { mrp?: string | number | null; prim_price?: { sp?: string | number | null } | null } | null } | null;
  visibility?: { sa_id?: number | null; fc_id?: number | null } | null;
  images?: BbImage[] | null;
  children?: BbProduct[] | null;
}

export interface BbSearchResponse {
  tabs?: { product_info?: { products?: BbProduct[] | null } | null }[] | null;
  is_llm_flow?: boolean | null;
  errors?: { code?: number | string | null; msg?: string | null }[] | null;
}

// --- Location parsing (pure) -------------------------------------------------------

export interface Place {
  serviceable: boolean;
  area: string | null;
  pincode: string | null;
  city: string | null;
}

/**
 * Pure: true when a non-2xx answer is BigBasket refusing the place itself
 * (`type: "SERVICEABILITY ERROR"`, e.g. SERVE4056), as opposed to a failure.
 */
export function isServiceabilityError(status: number, body: string): boolean {
  if (status >= 200 && status < 300) return false;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return false;
  }
  const errors = (json as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e: { type?: unknown; code_str?: unknown } | null) => {
    const type = typeof e?.type === 'string' ? e.type.trim().toUpperCase() : '';
    const code = typeof e?.code_str === 'string' ? e.code_str.trim().toUpperCase() : '';
    return type === SERVICEABILITY_ERROR_TYPE || code === SERVICEABILITY_ERROR_CODE;
  });
}

export function parseServiceable(json: BbServiceable): Place {
  if (!json || typeof json !== 'object' || !json.serviceable_ecs_info) {
    throw new UpstreamError('BigBasket serviceable response had no serviceable_ecs_info');
  }
  const flag = json.serviceable_ecs_info[BBNOW_KEY]?.serviceable;
  const place = json.places_info ?? {};
  return {
    serviceable: typeof flag === 'string' && flag !== '' && !NOT_SERVICEABLE.has(flag),
    area: place.area?.trim() || null,
    pincode: place.pincode ? String(place.pincode).trim() : null,
    city: place.city?.trim() || null,
  };
}

export interface Session {
  saIds: number[];
  primarySaId: number;
  eta: string | null;
  area: string | null;
  pincode: string | null;
  city: string | null;
}

function toNum(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
}

/**
 * Pure: the header call after the PUT → the verified session. Throws when
 * BigBasket reports an address other than (lat, lng): that is the one moment
 * we can see which place the session will be priced for.
 */
export function parseHeader(json: BbHeader, lat: number, lng: number): Session {
  const addresses = Array.isArray(json?.addresses) ? json.addresses : [];
  const selected = addresses.find((a) => String(a?.id) === String(json.selected_address_id)) ?? addresses[0];
  const aLat = toNum(selected?.lat);
  const aLng = toNum(selected?.lng);
  if (!selected || Math.abs(aLat - lat) > LOCATION_TOLERANCE_DEG || Math.abs(aLng - lng) > LOCATION_TOLERANCE_DEG) {
    const where = selected ? `${selected.lat},${selected.lng} (${selected.city_name ?? '?'})` : 'no address';
    throw new UpstreamError(`BigBasket placed the session at ${where}, not ${lat},${lng}`);
  }

  const cookieIds = String(json.additional_cookies?.[SA_IDS_COOKIE] ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const slotIds = (json.next_available_slots ?? []).map((s) => s?.sa_id).filter((n): n is number => typeof n === 'number' && n > 0);
  const saIds = cookieIds.length ? cookieIds : slotIds;
  if (saIds.length === 0) throw new UpstreamError('BigBasket header named no service area for this location');

  const slot = (json.next_available_slots ?? []).find((s) => typeof s?.sa_id === 'number' && saIds.includes(s.sa_id));
  const primarySaId = slot?.sa_id ?? saIds[0];
  const listed = (json.sa_list ?? []).find((s) => s?.sa_id === primarySaId);
  const eta = slot?.short_eta?.trim() || slot?.eta_message?.trim() || listed?.eta?.trim() || null;

  return {
    saIds,
    primarySaId,
    eta,
    area: selected.area?.trim() || null,
    pincode: selected.pin !== null && selected.pin !== undefined ? String(selected.pin) : null,
    city: selected.city_name?.trim() || null,
  };
}

// --- Search parsing (pure) -----------------------------------------------------------

function toRupees(value: unknown): number | null {
  const n = toNum(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * TITLE: the card prints `brand.name` on its own line above `desc`, and `desc`
 * is often brandless ("Pasteurised Butter" for Amul). Rejoin them the way the
 * site's own /pd/ slugs do; the brand keeps the catalogue's casing.
 */
export function composeTitle(desc: string, brand: string | null): string {
  if (!brand || !desc) return desc;
  return squash(desc).startsWith(squash(brand)) ? desc : `${brand} ${desc}`;
}

function firstImage(images: BbImage[] | null | undefined): string | null {
  for (const img of images ?? []) {
    const url = img?.l ?? img?.m ?? img?.s;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return null;
}

function toListing(item: BbProduct, parent: BbProduct, fetchedAt: string): Listing | null {
  const id = item.id === null || item.id === undefined ? '' : String(item.id);
  const desc = item.desc?.trim() || parent.desc?.trim() || '';
  const path = item.absolute_url?.trim() ?? '';
  const price = toRupees(item.pricing?.discount?.prim_price?.sp);
  if (!id || !desc || !path || price === null) return null;
  // Visible on the site, but no buy path: a price nobody can pay.
  if (item.availability?.not_for_sale === true) return null;

  const brand = (item.brand?.name ?? parent.brand?.name)?.trim() || null;
  const marked = toRupees(item.pricing?.discount?.mrp);
  return {
    platformId: 'bigbasket',
    listingId: id,
    title: composeTitle(desc, brand),
    brand,
    quantityText: item.w?.trim() ?? '',
    price,
    mrp: marked !== null && marked >= price ? marked : null,
    inStock: item.availability?.avail_status === AVAIL_IN_STOCK,
    productUrl: new URL(path, SITE).toString(),
    imageUrl: firstImage(item.images) ?? firstImage(parent.images),
    category: item.category?.llc_name?.trim() || parent.category?.llc_name?.trim() || null,
    fetchedAt,
  };
}

/**
 * Pure: a listing response → listings, one per pack size (parent + children).
 * Throws SessionProblem if ANY row is from a service area outside `saIds`: a
 * response that mixes in another area is not trusted row by row.
 */
export function parseSearchResponse(json: BbSearchResponse, saIds: number[], fetchedAt = new Date().toISOString()): Listing[] {
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    const first = json.errors[0];
    throw new SessionProblem(`BigBasket listing error ${first?.code ?? '?'}: ${first?.msg ?? 'unknown'}`);
  }
  // LLM_FALLBACK: forty plausible rows about the wrong thing. Nothing beats that.
  if (json?.[LLM_FALLBACK_FIELD] === true) return [];

  const products = json?.tabs?.[0]?.product_info?.products;
  if (!Array.isArray(products)) {
    throw new UpstreamError('BigBasket search response had no tabs[0].product_info.products array');
  }

  const allowed = new Set(saIds);
  for (const product of products) {
    for (const item of [product, ...(product?.children ?? [])]) {
      const sa = item?.visibility?.sa_id ?? product?.visibility?.sa_id;
      if (typeof sa !== 'number' || !allowed.has(sa)) {
        throw new SessionProblem(`BigBasket priced item ${item?.id} for service area ${sa ?? 'unknown'}, not ${saIds.join('/')}`);
      }
    }
  }

  const listings: Listing[] = [];
  for (const product of products) {
    const rows = [product, ...(product.children ?? [])]
      .map((item) => toListing(item, product, fetchedAt))
      .filter((l): l is Listing => l !== null);
    if (rows.length === 0) continue;
    // Keep a pack-size ladder whole; cut between products.
    if (listings.length > 0 && listings.length + rows.length > MAX_LISTINGS) break;
    listings.push(...rows);
  }
  return listings;
}

// --- Network ---------------------------------------------------------------------------

interface BbContext {
  lat: number;
  lng: number;
  cookie: string;
  saIds: number[];
  locatedAt: number;
}

interface Located {
  cookie: string;
  session: Session;
}

async function send(path: string, jar: CookieJar, init: RequestInit & { headers?: Record<string, string> }, ctx: AdapterContext): Promise<Response> {
  const cookie = jar.header();
  const res = await plainFetch(`${SITE}${path}`, {
    ...init,
    signal: ctx.signal,
    headers: { ...init.headers, ...(cookie ? { cookie } : {}) },
  });
  jar.absorb(res);
  return res;
}

function parseBody<T>(res: Response, body: string, what: string): T {
  if (!res.ok) throw new UpstreamError(`BigBasket ${what}: HTTP ${res.status} ${body.slice(0, 120)}`, res.status);
  assertJsonBody(body, 'www.bigbasket.com');
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new UpstreamError(`BigBasket ${what}: malformed JSON`);
  }
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  return parseBody<T>(res, await res.text(), what);
}

/** A location step's JSON, or NOT_HERE when BigBasket refuses the place itself. */
const NOT_HERE = Symbol('not serviceable');
async function readLocationJson<T>(res: Response, what: string, ctx: AdapterContext): Promise<T | typeof NOT_HERE> {
  const body = await res.text();
  if (isServiceabilityError(res.status, body)) {
    ctx.log(`BigBasket ${what}: HTTP ${res.status} SERVICEABILITY ERROR — not served here now`);
    return NOT_HERE;
  }
  return parseBody<T>(res, body, what);
}

/**
 * The site's own guest flow: session → serviceability → set delivery location
 * → header. Returns null when BB Now does not serve (lat, lng).
 */
async function locate(lat: number, lng: number, ctx: AdapterContext): Promise<Located | null> {
  const jar = new CookieJar();

  const boot = await send(`${BOOTSTRAP_PATH}?${new URLSearchParams({ q: BOOTSTRAP_TERM })}`, jar, { headers: { accept: HTML_ACCEPT } }, ctx);
  await boot.text();
  if (!boot.ok) throw new UpstreamError(`BigBasket bootstrap: HTTP ${boot.status}`, boot.status);
  if (!jar.get(VISITOR_COOKIE)) throw new UpstreamError('BigBasket bootstrap issued no guest session');

  const serviceableQuery = new URLSearchParams({ lat: String(lat), lng: String(lng), send_all_serviceability: 'true' });
  const serviceable = await readLocationJson<BbServiceable>(
    await send(`${SERVICEABLE_PATH}?${serviceableQuery}`, jar, { headers: LOCATION_HEADERS }, ctx),
    'serviceable',
    ctx,
  );
  if (serviceable === NOT_HERE) return null;
  const place = parseServiceable(serviceable);
  if (!place.serviceable) return null;

  const csrf = jar.get(CSRF_COOKIE);
  if (!csrf) throw new UpstreamError('BigBasket issued no csurftoken; cannot set the delivery location');
  const put = await send(
    SET_LOCATION_PATH,
    jar,
    {
      method: 'PUT',
      headers: {
        ...LOCATION_HEADERS,
        ...ENTRY_CONTEXT_HEADERS,
        [CSRF_HEADER]: csrf,
        'x-tracker': crypto.randomUUID(),
        origin: SITE,
        referer: `${SITE}/`,
      },
      body: JSON.stringify({
        lat,
        long: lng,
        return_hub_cookies: false,
        ...(place.area ? { area: place.area } : {}),
        ...(place.pincode ? { contact_zipcode: place.pincode } : {}),
      }),
    },
    ctx,
  );
  if ((await readLocationJson<unknown>(put, 'set-location', ctx)) === NOT_HERE) return null;
  for (const [name, value] of Object.entries(ENTRY_CONTEXT_COOKIES)) jar.set(name, value);

  const headerQuery = new URLSearchParams({ _: String(Date.now()), send_address_set_by_user: 'true', send_door_info: 'true' });
  const header = await readJson<BbHeader>(
    await send(`${HEADER_PATH}?${headerQuery}`, jar, { headers: { ...API_HEADERS, ...ENTRY_CONTEXT_HEADERS } }, ctx),
    'header',
  );
  for (const [name, value] of Object.entries(header.additional_cookies ?? {})) {
    if (typeof value === 'string') jar.set(name, value);
  }
  const session = parseHeader(header, lat, lng);
  return { cookie: jar.header(), session };
}

/** One re-location at a time per store, and not more often than the cooldown. */
const relocating = new WeakMap<BbContext, Promise<void>>();

function relocate(c: BbContext, ctx: AdapterContext): Promise<void> {
  const running = relocating.get(c);
  if (running) return running;
  const job = (async () => {
    const fresh = await locate(c.lat, c.lng, ctx);
    if (!fresh) throw new UpstreamError('BigBasket no longer serves this location');
    c.cookie = fresh.cookie;
    c.saIds = fresh.session.saIds;
    c.locatedAt = Date.now();
  })().finally(() => relocating.delete(c));
  relocating.set(c, job);
  return job;
}

async function searchOnce(term: string, c: BbContext, ctx: AdapterContext): Promise<Listing[]> {
  const query = new URLSearchParams({ type: TYPE_PRODUCT_SEARCH, slug: term, page: '1' });
  const res = await plainFetch(`${SITE}${SEARCH_PATH}?${query}`, {
    signal: ctx.signal,
    headers: { ...API_HEADERS, ...ENTRY_CONTEXT_HEADERS, cookie: c.cookie },
  });
  const body = await res.text();
  // VERIFIED 2026-09-27: an unmatched term is 204 with no body — "no results".
  if (res.status === 204) return [];
  // Any other empty body is a broken answer, not an empty shelf.
  if (body.trim() === '') throw new UpstreamError(`BigBasket search: empty body (HTTP ${res.status})`, res.status);
  let json: BbSearchResponse;
  try {
    json = JSON.parse(body) as BbSearchResponse;
  } catch {
    assertJsonBody(body, 'www.bigbasket.com');
    throw new UpstreamError(`BigBasket search: malformed JSON (HTTP ${res.status})`, res.status);
  }
  if (!json || typeof json !== 'object') throw new UpstreamError('BigBasket search: JSON was not an object', res.status);
  // An `errors` payload (400/404) means the session is not usable → SessionProblem.
  if (Array.isArray(json.errors) && json.errors.length > 0) return parseSearchResponse(json, c.saIds);
  if (!res.ok) throw new UpstreamError(`BigBasket search: HTTP ${res.status}`, res.status);
  return parseSearchResponse(json, c.saIds);
}

function contextOf(store: ResolvedStore): BbContext {
  const c = store.context as Partial<BbContext>;
  const ok =
    typeof c.lat === 'number' &&
    typeof c.lng === 'number' &&
    typeof c.cookie === 'string' &&
    c.cookie !== '' &&
    Array.isArray(c.saIds) &&
    c.saIds.length > 0;
  // Without a located session BigBasket prices the server's own area. Refuse.
  if (!ok) throw new UpstreamError('BigBasket store has no located session; refusing to search');
  return c as BbContext;
}

// --- Adapter -------------------------------------------------------------------------------

const adapter: PlatformAdapter = {
  id: 'bigbasket',
  transport: 'plain',

  async resolveStore(location: GeoLocation, ctx: AdapterContext): Promise<ResolvedStore | null> {
    const { lat, lng } = location;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('BigBasket needs coordinates');
    const located = await locate(lat, lng, ctx);
    if (!located) {
      ctx.log('BB Now does not serve this location');
      return null;
    }
    const { session, cookie } = located;
    const context: BbContext = { lat, lng, cookie, saIds: session.saIds, locatedAt: Date.now() };
    const place = session.area ?? session.city;
    return {
      storeId: String(session.primarySaId),
      label: place ? `BB Now ${place}` : `BB Now area ${session.primarySaId}`,
      eta: session.eta,
      context: context as unknown as Record<string, unknown>,
    };
  },

  async search(query: string, store: ResolvedStore, ctx: AdapterContext): Promise<Listing[]> {
    const c = contextOf(store);
    const term = query.trim();
    if (!term) return [];
    try {
      return await searchOnce(term, c, ctx);
    } catch (e) {
      if (!(e instanceof SessionProblem) || Date.now() - c.locatedAt < RELOCATE_COOLDOWN_MS) throw e;
      ctx.log(`${e.message}; re-locating the session once`);
      await relocate(c, ctx);
      return searchOnce(term, c, ctx);
    }
  },
};

export default adapter;
