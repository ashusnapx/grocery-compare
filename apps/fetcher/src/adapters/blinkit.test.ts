/**
 * Blinkit adapter, offline. Fixtures in test/fixtures/blinkit/ are real
 * responses captured on 2026-09-27 (see docs/research/2026-09-27-spike-s1-blinkit.md),
 * trimmed to the fields the adapter reads. No cookie, token or device id is in them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GeoLocation } from '@gc/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../transports/impersonate', () => ({
  createImpersonator: vi.fn(() => ({})),
  impersonateJson: vi.fn(),
}));

import { BlockedError, UpstreamError } from '../errors';
import { impersonateJson } from '../transports/impersonate';
import adapter, { parseCartFeeHints, parseEtaResponse, parseSearchResponse, rupeesOf, searchUrl, slugify } from './blinkit';
import type { AdapterContext, ResolvedStore } from './types';

const FIXTURES = fileURLToPath(new URL('../../test/fixtures/blinkit/', import.meta.url));
// Parsed fresh each time, so a test that edits one cannot leak into another.
const fixture = (name: string): any => JSON.parse(readFileSync(FIXTURES + name, 'utf8'));
const FETCHED_AT = '2026-09-27T10:13:34.000Z';

const KORAMANGALA: GeoLocation = { lat: 12.9352, lng: 77.6245, pincode: '560034', approximate: false, label: 'Koramangala' };
const ANDHERI_WEST: GeoLocation = { lat: 19.1364, lng: 72.8296, pincode: '400053', approximate: false };
const KAVARATTI: GeoLocation = { lat: 10.5667, lng: 72.6417, pincode: '682555', approximate: false };

const ETA_URL = 'https://blinkit.com/v1/consumerweb/eta';
const CART_URL = 'https://blinkit.com/v5/carts';

function productCards(page: any): any[] {
  return page.response.snippets.filter((s: any) => s.widget_type.startsWith('product_card_snippet_type_'));
}

describe('parseSearchResponse', () => {
  it('reads a Koramangala onion page and stops at "Showing related products"', () => {
    const page = parseSearchResponse(fixture('search-onion-560034.json'), FETCHED_AT);

    expect(page.listings[0]).toEqual({
      platformId: 'blinkit',
      listingId: '530158',
      title: 'Onion (Eerulli)',
      brand: 'Freshbury',
      quantityText: '1 kg',
      price: 66,
      mrp: 75,
      inStock: true,
      productUrl: 'https://blinkit.com/prn/onion-eerulli/prid/530158',
      imageUrl: expect.stringMatching(/^https:\/\/cdn\.grofers\.com\//),
      category: 'Onion',
      fetchedAt: FETCHED_AT,
    });
    // 7 products before the related header, then the one extra pack size of the first.
    expect(page.listings.map((l) => l.listingId)).toEqual([
      '530158', '355012', '595308', '803205', '145447', '780338', '711550', '532987',
    ]);
    expect(page.listings.some((l) => /tomato/i.test(l.title))).toBe(false);
    expect(page.merchantIds.sort()).toEqual(['37746', '40076']);
    expect(page).toMatchObject({ unlocated: 0, unpriced: 0 });
  });

  it('keeps a card without a brand as brand null, and its pack text untouched', () => {
    const spring = parseSearchResponse(fixture('search-onion-560034.json'), FETCHED_AT).listings[1];
    expect(spring).toMatchObject({ title: 'Spring Onion (Eerulli Soppu)', brand: null, quantityText: '250 g', price: 21, mrp: 26 });
  });

  it('lists other pack sizes after every page-1 product, with their own stock', () => {
    const { listings } = parseSearchResponse(fixture('search-amul-butter-560034.json'), FETCHED_AT);
    const ids = listings.map((l) => l.listingId);
    expect(ids.slice(0, 5)).toEqual(['427609', '529128', '479676', '19507', '498972']);
    const small = listings.find((l) => l.listingId === '427609')!;
    const large = listings.find((l) => l.listingId === '427610')!;
    expect(small).toMatchObject({ quantityText: '100 g', price: 50, mrp: 50, inStock: true, brand: 'Amul Lite' });
    // Blinkit sends is_sold_out: false here; product_state and inventory say otherwise.
    expect(large).toMatchObject({ quantityText: '500 g', price: 240, inStock: false, brand: 'Amul Lite' });
    expect(ids.indexOf('427610')).toBeGreaterThan(ids.indexOf('498972'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prices in rupees: cart price equals the ₹ text on every card', () => {
    for (const name of ['search-onion-560034.json', 'search-amul-butter-560034.json', 'search-onion-400053.json']) {
      const raw = fixture(name);
      const { listings } = parseSearchResponse(raw, FETCHED_AT);
      for (const card of productCards(raw)) {
        const listing = listings.find((l) => l.listingId === card.data.identity.id);
        if (listing) expect(listing.price).toBe(rupeesOf(card.data.normal_price.text));
      }
    }
  });

  it('returns no listings for a query Blinkit has nothing for', () => {
    expect(parseSearchResponse(fixture('search-no-results.json'), FETCHED_AT)).toEqual({
      listings: [],
      merchantIds: [],
      unlocated: 0,
      unpriced: 0,
    });
  });

  it('returns no listings when the page is only "related products"', () => {
    const raw = fixture('search-onion-560034.json');
    const related = raw.response.snippets.findIndex((s: any) => /related products/.test(s.data?.title?.text ?? ''));
    raw.response.snippets = [raw.response.snippets[0], ...raw.response.snippets.slice(related)];
    expect(parseSearchResponse(raw, FETCHED_AT).listings).toEqual([]);
  });

  it('drops a card whose cart price disagrees with its ₹ text (e.g. a switch to paise)', () => {
    const raw = fixture('search-onion-560034.json');
    productCards(raw)[0].data.atc_action.add_to_cart.cart_item.price = 6600;
    const page = parseSearchResponse(raw, FETCHED_AT);
    expect(page.listings.map((l) => l.listingId)).not.toContain('530158');
    expect(page.unpriced).toBe(1);
  });

  it('drops an MRP below the price rather than show a negative saving', () => {
    const raw = fixture('search-onion-560034.json');
    productCards(raw)[0].data.atc_action.add_to_cart.cart_item.mrp = 10;
    delete productCards(raw)[0].data.mrp;
    expect(parseSearchResponse(raw, FETCHED_AT).listings[0]).toMatchObject({ price: 66, mrp: null });
  });

  it('counts rows without a merchant id as unlocated', () => {
    const raw = fixture('search-onion-560034.json');
    const first = productCards(raw)[0].data;
    delete first.merchant_id;
    delete first.atc_action.add_to_cart.cart_item.merchant_id;
    expect(parseSearchResponse(raw, FETCHED_AT).unlocated).toBe(1);
  });

  it('caps a page at 24 listings, page-1 products first', () => {
    const raw = fixture('search-onion-560034.json');
    const card = productCards(raw)[1];
    raw.response.snippets = Array.from({ length: 30 }, (_, i) => {
      const copy = structuredClone(card);
      copy.data.identity.id = String(900000 + i);
      return copy;
    });
    const { listings } = parseSearchResponse(raw, FETCHED_AT);
    expect(listings).toHaveLength(24);
    expect(listings[23].listingId).toBe('900023');
  });

  it('throws on shape drift instead of reporting "no results"', () => {
    expect(() => parseSearchResponse('<html>', FETCHED_AT)).toThrow(UpstreamError);
    expect(() => parseSearchResponse({ is_success: false, response: { snippets: [] } }, FETCHED_AT)).toThrow(/is_success=false/);
    expect(() => parseSearchResponse({ is_success: true, response: {} }, FETCHED_AT)).toThrow(/snippets/);

    const raw = fixture('search-onion-560034.json');
    for (const card of productCards(raw)) {
      delete card.data.normal_price;
      delete card.data.atc_action;
      delete card.data.variant_list;
    }
    expect(() => parseSearchResponse(raw, FETCHED_AT)).toThrow(/none could be priced/);
  });
});

describe('parseEtaResponse', () => {
  it('reads the serving merchants and ETA for Koramangala', () => {
    const eta = parseEtaResponse(fixture('eta-560034.json'));
    expect(eta).toEqual({
      serviceable: true,
      merchantId: '40076',
      merchantIds: ['40076', '35940', '37746', '45326'],
      minutes: 13,
      title: 'Delivery in 13 minutes',
    });
  });

  it('reports an unserviceable point', () => {
    expect(parseEtaResponse(fixture('eta-unserviceable-kavaratti.json'))).toEqual({
      serviceable: false,
      status: 'Non Serviceable',
    });
  });

  it('throws when the answer is neither a merchant nor "Non Serviceable"', () => {
    expect(() => parseEtaResponse({ update_eta_action: {} })).toThrow(UpstreamError);
    expect(() => parseEtaResponse({ status_code: 'Store Closed' })).toThrow(/Store Closed/);
  });
});

describe('parseCartFeeHints', () => {
  // Live 2026-09-29, logged out: delivery ₹25 below ₹99, handling ₹2, no small-cart fee, no surge.
  const LIVE = { deliveryFee: 25, freeDeliveryAbove: 99, handlingFee: 2, smallCartFee: 0, surgeFee: 0 };

  it('reads the fees an empty guest cart states for Koramangala', () => {
    expect(parseCartFeeHints(fixture('cart-empty-560034.json'))).toEqual(LIVE);
  });

  it('reads the same fees for Andheri West, as Blinkit quoted them there', () => {
    expect(parseCartFeeHints(fixture('cart-empty-400053.json'))).toEqual(LIVE);
  });

  it('takes the threshold from the delivery rule, not bill_details.free_delivery_mov (800 here)', () => {
    const raw = fixture('cart-empty-560034.json');
    expect(raw.cart_data.bill_details.free_delivery_mov).toBe(800);
    expect(parseCartFeeHints(raw)?.freeDeliveryAbove).toBe(99);
  });

  it('agrees with the bill the site rendered for a ₹21 cart, and does not charge its unused small-cart config', () => {
    const raw = fixture('cart-item-560034.json');
    // The page's own bill: ₹21 + ₹25 delivery + ₹2 handling = ₹48, no small-cart line.
    const charges = raw.cart_data.shipments[0].bill_details.charges.map((c: any) => [c.charge_id, c.amount]);
    expect(charges).toEqual([[3, 2], [13, 25]]);
    expect(raw.bill_widget_lines.map((l: any) => l.left)).not.toContain('Small cart charge');
    expect(raw.cart_data.bill_details.surge_charge_v2).toMatchObject({ small_cart_fee: 15, small_cart_mov: 99, source: '' });
    // Same rules as the empty cart; small cart and surge are left to the catalog (no "no_surge" statement).
    expect(parseCartFeeHints(raw)).toEqual({ deliveryFee: 25, freeDeliveryAbove: 99, handlingFee: 2 });
  });

  it('reads a surge in force, and a checkout block, but then says nothing about small carts', () => {
    const raw = fixture('cart-empty-560034.json');
    Object.assign(raw.cart_data.bill_details.surge_charge_v2, { surge_amount: 20, source: 'rain', checkouts_block_mov: 150 });
    expect(parseCartFeeHints(raw)).toEqual({ deliveryFee: 25, freeDeliveryAbove: 99, handlingFee: 2, surgeFee: 20, minOrder: 150 });
  });

  it('leaves a surge that only applies below some cart value to the catalog', () => {
    const raw = fixture('cart-empty-560034.json');
    Object.assign(raw.cart_data.bill_details.surge_charge_v2, { surge_amount: 15, source: 'mec', mov: 99 });
    expect(parseCartFeeHints(raw)).not.toHaveProperty('surgeFee');
  });

  it('says nothing about delivery when the tier table has two paid steps or contradicts itself', () => {
    const graded = fixture('cart-empty-560034.json');
    graded.cart_data.bill_details.flat_delivery_charge_attributes.graded_delivery_charge_constructs = [
      { min_amount: 0, max_amount: 99, delivery_charge: 30 },
      { min_amount: 99, max_amount: 199, delivery_charge: 15 },
      { min_amount: 199, max_amount: 1000, delivery_charge: 0 },
    ];
    expect(parseCartFeeHints(graded)).not.toHaveProperty('deliveryFee');
    expect(parseCartFeeHints(graded)).not.toHaveProperty('freeDeliveryAbove');

    const contradicting = fixture('cart-empty-560034.json');
    contradicting.cart_data.bill_details.flat_delivery_charge_attributes.free_delivery_mov = 149;
    expect(parseCartFeeHints(contradicting)).not.toHaveProperty('freeDeliveryAbove');
  });

  it('reads free delivery at every cart value as a ₹0 delivery fee', () => {
    const raw = fixture('cart-empty-560034.json');
    const rule = raw.cart_data.bill_details.flat_delivery_charge_attributes;
    rule.graded_delivery_charge_constructs = [{ min_amount: 0, max_amount: 1000, delivery_charge: 0 }];
    rule.flat_delivery_charge = 0;
    expect(parseCartFeeHints(raw)).toMatchObject({ deliveryFee: 0 });
    expect(parseCartFeeHints(raw)).not.toHaveProperty('freeDeliveryAbove');
  });

  it('reads handling only when it is flat, and "none in force" when its family is empty', () => {
    const graded = fixture('cart-empty-560034.json');
    graded.cart_data.additional_charges[0].meta.variation = [
      { amount: 5, mov: 0 },
      { amount: 2, mov: 199 },
    ];
    expect(parseCartFeeHints(graded)).not.toHaveProperty('handlingFee');

    const none = fixture('cart-empty-560034.json');
    none.page_meta.custom_data.platform_charges_data.handling_charge = {};
    none.cart_data.additional_charges = [];
    expect(parseCartFeeHints(none)).toMatchObject({ handlingFee: 0 });
  });

  it('leaves small carts to the catalog when a small-cart charge is assigned', () => {
    const raw = fixture('cart-empty-560034.json');
    raw.page_meta.custom_data.platform_charges_data.small_cart_charge = { assignment_tag: 'mov_99|scc_20', assignment_type: 'control' };
    expect(parseCartFeeHints(raw)).not.toHaveProperty('smallCartFee');
  });

  it('throws on an answer that is not a cart, and returns undefined when a cart states nothing', () => {
    expect(() => parseCartFeeHints(fixture('search-no-results.json'))).toThrow(UpstreamError);
    expect(() => parseCartFeeHints(undefined)).toThrow(UpstreamError);
    expect(parseCartFeeHints({ cart_data: {} })).toBeUndefined();
  });
});

describe('helpers', () => {
  it('slugify reproduces the canonical URLs Blinkit served live', () => {
    expect(slugify('Tata Sampann Unpolished Toor Dal (Togari Bele)')).toBe('tata-sampann-unpolished-toor-dal-togari-bele');
    // Cut at 48 characters with no trailing hyphen; this URL answered 200 on 2026-09-27.
    expect(slugify('Fortune Unpolished Arhar Dal/ Toor Dal (Togari Bele)')).toBe('fortune-unpolished-arhar-dal-toor-dal-togari-bel');
    expect(slugify('!!!')).toBe('p');
  });

  it('rupeesOf needs a rupee sign', () => {
    expect(rupeesOf('₹66')).toBe(66);
    expect(rupeesOf('₹1,299')).toBe(1299);
    expect(rupeesOf('₹ 12.50')).toBe(12.5);
    expect(rupeesOf('1299')).toBeNull();
    expect(rupeesOf(null)).toBeNull();
  });

  it('searchUrl is the verified search request', () => {
    expect(searchUrl('amul butter')).toBe('https://blinkit.com/v1/layout/search?q=amul%20butter&search_type=type_to_search');
  });
});

describe('adapter, transport mocked', () => {
  const json = vi.mocked(impersonateJson);
  let ctx: AdapterContext & { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    json.mockReset();
    ctx = { signal: new AbortController().signal, log: vi.fn() };
  });

  /** Answers ETA calls with `eta`, guest-cart calls with `cart` and search calls with `page`. */
  function route(eta: () => unknown, page: () => unknown, cart: () => unknown = () => fixture('cart-empty-560034.json')) {
    json.mockImplementation(async (url: string) => (url.startsWith(ETA_URL) ? eta() : url.startsWith(CART_URL) ? cart() : page()));
  }
  const etaCalls = () => json.mock.calls.filter(([url]) => url.startsWith(ETA_URL)).length;
  const callTo = (prefix: string) => json.mock.calls.find(([url]) => url.startsWith(prefix));

  it('uses the impersonate transport', () => {
    expect(adapter.transport).toBe('impersonate');
  });

  it('resolves a store from the ETA endpoint, with coordinates in headers and cookies', async () => {
    json.mockResolvedValueOnce(fixture('eta-560034.json'));
    const store = await adapter.resolveStore(KORAMANGALA, ctx);

    expect(store).toEqual({
      storeId: '40076',
      label: 'Koramangala',
      eta: '13 mins',
      context: { lat: '12.9352', lon: '77.6245', merchantIds: ['40076', '35940', '37746', '45326'] },
    });
    const [url, init] = json.mock.calls[0];
    expect(url).toBe(ETA_URL);
    expect(init).toMatchObject({ method: 'GET', signal: ctx.signal });
    expect(init?.headers).toMatchObject({
      lat: '12.9352',
      lon: '77.6245',
      app_client: 'consumer_web',
      cookie: 'gr_1_lat=12.9352; gr_1_lon=77.6245',
      'sec-fetch-mode': 'cors',
    });
    expect(init?.headers?.device_id).toMatch(/^[0-9a-f]{16}$/);
    expect(init).not.toHaveProperty('body');
  });

  it('reads the fees from an empty guest cart, sent alongside the ETA call', async () => {
    route(() => fixture('eta-560034.json'), () => fixture('search-onion-560034.json'));
    const store = await adapter.resolveStore(KORAMANGALA, ctx);

    expect(store?.feeHints).toEqual({ deliveryFee: 25, freeDeliveryAbove: 99, handlingFee: 2, smallCartFee: 0, surgeFee: 0 });
    const [url, init] = callTo(CART_URL)!;
    expect(url).toBe(CART_URL);
    expect(init).toMatchObject({ method: 'POST', body: '{"items":[]}', signal: ctx.signal });
    expect(init?.headers).toMatchObject({ lat: '12.9352', lon: '77.6245', qd_sdk_request: 'true', origin: 'https://blinkit.com' });
    expect(json).toHaveBeenCalledTimes(2);
  });

  it('keeps the store, without fees, when the guest cart fails or changes shape', async () => {
    route(() => fixture('eta-560034.json'), () => fixture('search-onion-560034.json'), () => {
      throw new BlockedError('blinkit.com: Cloudflare challenge (HTTP 403)');
    });
    const blocked = await adapter.resolveStore(KORAMANGALA, ctx);
    expect(blocked).toMatchObject({ storeId: '40076', eta: '13 mins' });
    expect(blocked).not.toHaveProperty('feeHints');
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('fee lookup failed'));

    route(() => fixture('eta-560034.json'), () => fixture('search-onion-560034.json'), () => ({ is_success: true }));
    expect(await adapter.resolveStore(KORAMANGALA, ctx)).not.toHaveProperty('feeHints');
  });

  it('labels the store by id when the location has no label', async () => {
    json.mockResolvedValueOnce(fixture('eta-400053-at-1544-ist.json'));
    expect(await adapter.resolveStore(ANDHERI_WEST, ctx)).toMatchObject({ storeId: '47074', label: 'Blinkit store 47074', eta: '8 mins' });
  });

  it('returns null where Blinkit does not deliver', async () => {
    json.mockResolvedValueOnce(fixture('eta-unserviceable-kavaratti.json'));
    expect(await adapter.resolveStore(KAVARATTI, ctx)).toBeNull();
  });

  it('searches with a POST carrying the store coordinates', async () => {
    route(() => fixture('eta-560034.json'), () => fixture('search-onion-560034.json'));
    const store = (await adapter.resolveStore(KORAMANGALA, ctx))!;
    const listings = await adapter.search('  onion ', store, ctx);

    expect(listings.map((l) => l.listingId)[0]).toBe('530158');
    const [url, init] = callTo('https://blinkit.com/v1/layout/search')!;
    expect(url).toBe('https://blinkit.com/v1/layout/search?q=onion&search_type=type_to_search');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(init?.headers).toMatchObject({ lat: '12.9352', lon: '77.6245', origin: 'https://blinkit.com' });
    expect(etaCalls()).toBe(1); // merchants matched: no re-resolution
  });

  it('refuses a page priced by another city\'s dark store', async () => {
    route(() => fixture('eta-560034.json'), () => fixture('search-onion-400053.json'));
    const store = (await adapter.resolveStore(KORAMANGALA, ctx))!;

    await expect(adapter.search('onion', store, ctx)).rejects.toThrow(UpstreamError);
    await expect(adapter.search('onion', store, ctx)).rejects.toThrow(/47074.*another location/);
  });

  it('follows a dark-store reassignment instead of refusing it (33684 → 47074, as seen live)', async () => {
    let eta = fixture('eta-400053-at-1541-ist.json');
    route(() => eta, () => fixture('search-onion-400053.json'));
    const store = (await adapter.resolveStore(ANDHERI_WEST, ctx))!;
    expect(store.storeId).toBe('33684');

    eta = fixture('eta-400053-at-1544-ist.json');
    const [a, b] = await Promise.all([adapter.search('onion', store, ctx), adapter.search('onion', store, ctx)]);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(etaCalls()).toBe(2); // resolve + one shared refresh for both searches
    expect(store.context.merchantIds).toContain('47074');
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('33684'));

    await adapter.search('onion', store, ctx);
    expect(etaCalls()).toBe(2); // the refreshed merchants were kept
  });

  it('returns [] for no results without a location check', async () => {
    route(() => fixture('eta-560034.json'), () => fixture('search-no-results.json'));
    const store = (await adapter.resolveStore(KORAMANGALA, ctx))!;
    expect(await adapter.search('xqzvbnmwk', store, ctx)).toEqual([]);
    expect(etaCalls()).toBe(1);
  });

  it('does not spend a request on a blank query', async () => {
    const store: ResolvedStore = { storeId: '40076', label: null, eta: null, context: { lat: '1', lon: '2', merchantIds: [] } };
    expect(await adapter.search('   ', store, ctx)).toEqual([]);
    expect(json).not.toHaveBeenCalled();
  });

  it('passes a Cloudflare block through as BlockedError', async () => {
    json.mockRejectedValue(new BlockedError('blinkit.com: Cloudflare challenge (HTTP 403)'));
    const store: ResolvedStore = { storeId: '40076', label: null, eta: null, context: { lat: '12.9352', lon: '77.6245', merchantIds: ['40076'] } };
    await expect(adapter.search('onion', store, ctx)).rejects.toThrow(BlockedError);
    await expect(adapter.resolveStore(KORAMANGALA, ctx)).rejects.toThrow(BlockedError);
  });

  it('rejects a store another adapter resolved', async () => {
    const foreign: ResolvedStore = { storeId: '10744', label: null, eta: null, context: { storeId: 10744 } };
    await expect(adapter.search('onion', foreign, ctx)).rejects.toThrow(/not resolved by the Blinkit adapter/);
  });
});
