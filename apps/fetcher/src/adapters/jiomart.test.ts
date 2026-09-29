import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoLocation } from '@gc/engine';
import { UpstreamError } from '../errors';
import adapter, {
  pickGroceryStore,
  parseFeeQuote,
  parseSearchResponse,
  quantityTextOf,
  type JioDeliveryPromiseResponse,
  type JioFeeQuoteResponse,
  type JioItem,
  type JioSearchResponse,
} from './jiomart';
import type { AdapterContext, ResolvedStore } from './types';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../test/fixtures/jiomart/${name}`, import.meta.url), 'utf8')) as T;
}

const clone = <T>(v: T): T => structuredClone(v);
const ctx = (): AdapterContext => ({ signal: new AbortController().signal, log: () => {} });
const BLR: GeoLocation = { lat: 12.9352, lng: 77.6245, pincode: '560034', approximate: false };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Replaces global fetch with canned JSON responses, recording every call. */
function stubFetch(...bodies: unknown[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body as string | undefined,
      });
      const body = bodies.shift();
      if (body === undefined) throw new Error(`unexpected request ${url}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickGroceryStore', () => {
  it('picks the Groceries store among electronics and fashion stores (560034)', () => {
    const store = pickGroceryStore(fixture('delivery-promise-560034.json'));
    expect(store).toEqual({ uid: 13845, code: 'TM3D', city: 'Bengaluru', eta: '30 mins', minOrder: 99 });
  });

  it('keys on department, not uid: uid 3 is listed as Groceries and as Electronics (400053)', () => {
    const store = pickGroceryStore(fixture('delivery-promise-400053.json'));
    expect(store?.uid).toBe(3);
    expect(store?.eta).toBe('26 mins');
  });

  it('returns null where only electronics stores serve (110001)', () => {
    expect(pickGroceryStore(fixture('delivery-promise-110001.json'))).toBeNull();
  });

  it('finds the Delhi grocery store only when the point is sent (quick stores are polygons)', () => {
    expect(pickGroceryStore(fixture('delivery-promise-110017-pincode-only.json'))).toBeNull();
    expect(pickGroceryStore(fixture('delivery-promise-110017-geo.json'))).toEqual({
      uid: 13586,
      code: 'TL5T',
      city: 'Delhi',
      eta: '21 mins',
      minOrder: 99,
    });
  });

  it('skips a grocery store that is paused or not accepting orders', () => {
    const paused = clone(fixture<JioDeliveryPromiseResponse>('delivery-promise-560034.json'));
    const grocery = paused.items!.find((s) => s.department_name === 'Groceries')!;
    grocery.fulfillment_status = { state: 'PAUSED', customer_message: 'closed for now' };
    expect(pickGroceryStore(paused)).toBeNull();

    const closed = clone(fixture<JioDeliveryPromiseResponse>('delivery-promise-560034.json'));
    closed.items!.find((s) => s.department_name === 'Groceries')!.is_accepting_order = false;
    expect(pickGroceryStore(closed)).toBeNull();
  });

  it('throws on a response without items', () => {
    expect(() => pickGroceryStore({} as JioDeliveryPromiseResponse)).toThrow(UpstreamError);
  });
});

describe('parseSearchResponse', () => {
  const toorDal = () => fixture<JioSearchResponse>('search-toor-dal-store-13845.json');

  it('maps every row priced for the store', () => {
    const listings = parseSearchResponse(toorDal(), 13845, '2026-09-27T09:01:46.000Z');
    expect(listings).toHaveLength(12);
    expect(listings[0]).toEqual({
      platformId: 'jiomart',
      listingId: '7509550',
      title: 'Good Life Tur Dal 1 kg',
      brand: 'Good Life',
      quantityText: '1 kg',
      price: 163,
      mrp: 240,
      inStock: true,
      productUrl: 'https://www.jiomart.com/product/good-life-tur-dal-1-kg-mffmut-7509550',
      imageUrl: expect.stringMatching(/^https:\/\/cdn1\.jiomartjcp\.com\//),
      category: 'Toor Dal',
      fetchedAt: '2026-09-27T09:01:46.000Z',
    });
    for (const l of listings) {
      expect(l.price).toBeGreaterThan(0);
      expect(l.mrp === null || l.mrp >= l.price).toBe(true);
    }
  });

  it('reads the Mumbai store the same way (store 3)', () => {
    const listings = parseSearchResponse(fixture('search-amul-butter-store-3.json'), 3);
    expect(listings[0]).toMatchObject({ title: 'Amul Pasteurised Butter 100 g', quantityText: '100 g', price: 62, mrp: 63, brand: 'amul' });
  });

  it('refuses the response when a row is priced for another store', () => {
    const json = toorDal();
    json.items![3].price_list = [{ store_id: 3, is_sellable: true, price: json.items![3].price }];
    json.items![3].store_ids = [3];
    expect(() => parseSearchResponse(json, 13845)).toThrow(/refusing/);
  });

  it('refuses a row with no store evidence at all', () => {
    const json = toorDal();
    delete json.items![0].price_list;
    delete json.items![0].store_ids;
    expect(() => parseSearchResponse(json, 13845)).toThrow(UpstreamError);
  });

  it('accepts store_ids as evidence when price_list is absent', () => {
    const json = toorDal();
    delete json.items![0].price_list;
    expect(parseSearchResponse(json, 13845)[0].price).toBe(163);
  });

  it('marks unsellable rows out of stock', () => {
    const json = toorDal();
    json.items![1].price_list![0].is_sellable = false;
    json.items![2].sellable = false;
    const [, second, third] = parseSearchResponse(json, 13845);
    expect(second.inStock).toBe(false);
    expect(third.inStock).toBe(false);
  });

  it('returns [] for no results and throws on a changed shape', () => {
    expect(parseSearchResponse(fixture('search-no-results.json'), 13845)).toEqual([]);
    expect(() => parseSearchResponse({} as JioSearchResponse, 13845)).toThrow(UpstreamError);
  });
});

describe('parseFeeQuote', () => {
  it('reads the quick-grocery delivery fee and free-delivery threshold (Bengaluru TM3D, Mumbai TZT7)', () => {
    expect(parseFeeQuote(fixture('delivery-fee-quote-TM3D.json'), 'TM3D')).toEqual({ deliveryFee: 30, freeDeliveryAbove: 199 });
    expect(parseFeeQuote(fixture('delivery-fee-quote-TZT7.json'), 'TZT7')).toEqual({ deliveryFee: 30, freeDeliveryAbove: 199 });
  });

  it('ignores the other baskets in the quote (JIOMARTLITE ₹30 below ₹399 is not quick grocery)', () => {
    const quote = fixture<JioFeeQuoteResponse>('delivery-fee-quote-TM3D.json');
    expect(quote.result!.delivery_fee_list!.find((e) => e.config_name === 'JIOMARTLITE')).toMatchObject({ free_shipping_threshold: 399 });
    quote.result!.delivery_fee_list = quote.result!.delivery_fee_list!.filter((e) => e.config_name !== 'SMART_BAZAAR_BASKET');
    expect(parseFeeQuote(quote, 'TM3D')).toBeUndefined();
  });

  it('refuses a quote for another store and a changed shape', () => {
    expect(() => parseFeeQuote(fixture('delivery-fee-quote-TM3D.json'), 'TZT7')).toThrow(/TM3D, not TZT7/);
    expect(() => parseFeeQuote({} as JioFeeQuoteResponse, 'TM3D')).toThrow(UpstreamError);
  });

  it('reads free delivery as a ₹0 fee, and says nothing about a fee without a threshold', () => {
    const quote = (fee: unknown, threshold: unknown): JioFeeQuoteResponse =>
      ({ result: { delivery_fee_list: [{ config_name: 'SMART_BAZAAR_BASKET', shipping_fee: fee, free_shipping_threshold: threshold }] } }) as JioFeeQuoteResponse;
    expect(parseFeeQuote(quote(0, null), 'TM3D')).toEqual({ deliveryFee: 0 });
    expect(parseFeeQuote(quote('25', '149'), 'TM3D')).toEqual({ deliveryFee: 25, freeDeliveryAbove: 149 });
    expect(parseFeeQuote(quote(30, null), 'TM3D')).toBeUndefined();
  });
});

describe('quantityTextOf', () => {
  it('follows the product card: net quantity, then a real size, then "1 Pack"', () => {
    expect(quantityTextOf({ 'net-quantity-value': '"1"', 'net-quantity-unit': 'kg' } as JioItem)).toBe('1 kg');
    expect(quantityTextOf({ sizes: ['500 G'] } as JioItem)).toBe('500 G');
    expect(quantityTextOf({ sizes: ['OS'] } as JioItem)).toBe('1 Pack');
  });
});

describe('adapter (fetch stubbed)', () => {
  it('resolveStore sends the Fynd auth, pincode and point headers, and reports the minimum order and delivery fee', async () => {
    const calls = stubFetch(fixture('delivery-promise-560034.json'), fixture('delivery-fee-quote-TM3D.json'));
    const store = await adapter.resolveStore(BLR, ctx());
    expect(store).toMatchObject({ storeId: '13845', label: 'JioMart store TM3D, Bengaluru', eta: '30 mins' });
    expect(store?.feeHints).toEqual({ minOrder: 99, deliveryFee: 30, freeDeliveryAbove: 199 });
    expect(calls[0].url).toBe('https://api.jiomartjcp.com/service/application/logistics/v1.0/delivery-promise');
    expect(calls[0].headers.authorization).toBe(`Bearer ${btoa('685945f46c8c7aee3f3af605:TpKw7wD9h')}`);
    expect(JSON.parse(calls[0].headers['x-location-detail'])).toEqual({ pincode: '560034', country: 'India', country_iso_code: 'IN' });
    expect(JSON.parse(calls[0].headers['x-geolocation'])).toEqual({ latitude: '12.9352', longitude: '77.6245' });
    // The theme's own quote call: the store's code, the storefront id, nothing else.
    expect(calls[1].url).toBe('https://www.jiomart.com/ext/jmshipmentfee/delivery_fee/v1.0/quote?store_code=TM3D');
    expect(calls[1].headers['x-application-id']).toBe('685945f46c8c7aee3f3af605');
    expect(calls[1].headers).not.toHaveProperty('authorization');
  });

  it('resolveStore keeps the minimum order when the fee quote fails', async () => {
    const logs: string[] = [];
    stubFetch(fixture('delivery-promise-560034.json'), { message: 'oops' });
    const store = await adapter.resolveStore(BLR, { signal: new AbortController().signal, log: (m) => logs.push(m) });
    expect(store?.feeHints).toEqual({ minOrder: 99 });
    expect(logs.join('\n')).toMatch(/fee quote failed/);
  });

  it('resolveStore sends no point when the location has no coordinates', async () => {
    const calls = stubFetch(fixture('delivery-promise-110001.json'));
    expect(await adapter.resolveStore({ ...BLR, lat: Number.NaN, lng: Number.NaN, pincode: '110001' }, ctx())).toBeNull();
    expect(calls[0].headers).not.toHaveProperty('x-geolocation');
  });

  it('resolveStore returns null where there is no grocery store', async () => {
    stubFetch(fixture('delivery-promise-110001.json'));
    expect(await adapter.resolveStore({ ...BLR, pincode: '110001' }, ctx())).toBeNull();
  });

  it('search filters to the store uid', async () => {
    const calls = stubFetch(fixture('delivery-promise-560034.json'), fixture('delivery-fee-quote-TM3D.json'), fixture('search-toor-dal-store-13845.json'));
    const c = ctx();
    const store = (await adapter.resolveStore(BLR, c))!;
    const listings = await adapter.search('toor dal', store, c);
    expect(listings).toHaveLength(12);
    expect(calls[2].headers.authorization).toMatch(/^Bearer /);
    const url = new URL(calls[2].url);
    expect(url.origin + url.pathname).toBe('https://www.jiomart.com/ext/vertex/application/api/v1.0/products');
    expect(url.searchParams.get('q')).toBe('toor dal');
    expect(url.searchParams.get('f')).toBe('journey:quickcommerce:::store_ids:13845');
    expect(url.searchParams.get('page_size')).toBe('12');
  });

  it('search refuses to run without a store uid', async () => {
    const calls = stubFetch();
    const store: ResolvedStore = { storeId: 'x', label: null, eta: null, context: {} };
    await expect(adapter.search('toor dal', store, ctx())).rejects.toThrow(UpstreamError);
    expect(calls).toHaveLength(0);
  });
});
