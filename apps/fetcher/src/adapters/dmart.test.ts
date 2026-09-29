import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoLocation } from '@gc/engine';
import { UpstreamError } from '../errors';
import adapter, { parsePincodeResponse, parseSearchResponse, type DmPincodeResponse, type DmSearchResponse } from './dmart';
import type { AdapterContext, ResolvedStore } from './types';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../test/fixtures/dmart/${name}`, import.meta.url), 'utf8')) as T;
}

const ctx = (): AdapterContext => ({ signal: new AbortController().signal, log: () => {} });
const BLR: GeoLocation = { lat: 12.9352, lng: 77.6245, pincode: '560034', approximate: false };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function stubFetch(...bodies: unknown[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined });
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

describe('parsePincodeResponse', () => {
  it('maps a home-delivery pincode to its store', () => {
    expect(parsePincodeResponse(fixture('pincode-560034.json'), '560034')).toEqual({ storeId: '10744', label: 'DMart Ready KSRP Block, Bengaluru' });
    expect(parsePincodeResponse(fixture('pincode-400053.json'), '400053')).toEqual({ storeId: '10151', label: 'DMart Ready Andheri (W), Mumbai' });
  });

  it('returns null where DMart does not deliver (110001) or delivery is off', () => {
    expect(parsePincodeResponse(fixture('pincode-110001.json'), '110001')).toBeNull();
    const pickupOnly = fixture<DmPincodeResponse>('pincode-560034.json');
    pickupOnly.storePincodeDetails!.isHDEnabled = 'false';
    expect(parsePincodeResponse(pickupOnly, '560034')).toBeNull();
  });

  it('throws when DMart answers for another pincode', () => {
    expect(() => parsePincodeResponse(fixture('pincode-560034.json'), '560001')).toThrow(UpstreamError);
  });
});

describe('parseSearchResponse', () => {
  it('emits one listing per SKU with the site links and image', () => {
    const listings = parseSearchResponse(fixture('search-toor-dal-store-10744.json'), '2026-09-27T09:04:59.000Z');
    expect(listings[0]).toEqual({
      platformId: 'dmart',
      listingId: '1693527',
      title: 'DMart Swaad Toor Dal (Togari Bele) : 1 kg',
      brand: 'DMart Swaad',
      quantityText: '1 kg',
      price: 145,
      mrp: 192,
      inStock: true,
      productUrl: 'https://www.dmart.in/product/dmart-swaad-toor-dal?selectedProd=1693527',
      imageUrl: 'https://cdn.dmart.in/images/products/FEB110004839xx14FEB25_5_P.jpg',
      category: 'Dals & Pulses',
      fetchedAt: '2026-09-27T09:04:59.000Z',
    });
    // Premia Latur comes as two SKUs of one product: 500 g and 1 kg.
    expect(listings.slice(1, 3).map((l) => [l.listingId, l.quantityText, l.price])).toEqual([
      ['1389089', '500 g', 72],
      ['1389088', '1 kg', 153],
    ]);
  });

  it('puts the out-of-stock strip where the site does and keeps whole products under the cap', () => {
    const json = fixture<DmSearchResponse>('search-toor-dal-store-10744.json');
    const listings = parseSearchResponse(json);
    expect(listings.length).toBeLessThanOrEqual(20);
    const firstOos = listings.findIndex((l) => !l.inStock);
    expect(listings[firstOos].listingId).toBe('149009'); // Tata Sampann Toor Dal 500 gms, invStatus "0"
    // Five in-stock products (7 SKUs) come before the strip, as oosPosition "5" says.
    expect(firstOos).toBe(7);
    const ids = new Set(listings.map((l) => l.listingId));
    for (const p of [...json.products!, ...json.oosProducts!]) {
      const skus = p.sKUs!.map((s) => String(s.skuUniqueID));
      const kept = skus.filter((id) => ids.has(id));
      expect(kept.length === 0 || kept.length === skus.length).toBe(true);
    }
  });

  it('reads stock per SKU: Amul Butter 200 g is out while 100 g and 500 g are in (Mumbai)', () => {
    const listings = parseSearchResponse(fixture('search-amul-butter-store-10151.json'));
    const amul = listings.filter((l) => l.title.startsWith('Amul Butter :'));
    expect(amul.map((l) => [l.quantityText, l.price, l.inStock])).toEqual([
      ['100 g', 61, true],
      ['200 g', 124, false],
      ['500 g', 301, true],
    ]);
  });

  it('returns [] for no results and throws on a changed shape', () => {
    expect(parseSearchResponse(fixture('search-no-results.json'))).toEqual([]);
    expect(() => parseSearchResponse({} as DmSearchResponse)).toThrow(UpstreamError);
  });
});

describe('adapter (fetch stubbed)', () => {
  it('resolveStore posts the pincode and reports slot delivery', async () => {
    const calls = stubFetch(fixture('pincode-560034.json'));
    const store = await adapter.resolveStore(BLR, ctx());
    expect(store).toMatchObject({ storeId: '10744', eta: 'Slot delivery' });
    expect(calls[0]).toMatchObject({ url: 'https://digital.dmart.in/api/v2/pincodes/details', method: 'POST', body: '{"pincode":"560034"}' });
  });

  it('resolveStore returns null for 110001', async () => {
    stubFetch(fixture('pincode-110001.json'));
    expect(await adapter.resolveStore({ ...BLR, pincode: '110001' }, ctx())).toBeNull();
  });

  it('search always sends the storeId header', async () => {
    const calls = stubFetch(fixture('pincode-560034.json'), fixture('search-toor-dal-store-10744.json'));
    const c = ctx();
    const store = (await adapter.resolveStore(BLR, c))!;
    await adapter.search('toor dal', store, c);
    expect(calls[1].url).toBe('https://digital.dmart.in/api/v3/search/toor%20dal?page=1&buryOOS=true&size=50&channel=web&storeId=10744');
    expect(calls[1].headers.storeId).toBe('10744');
  });

  it('search refuses to run without a storeId (DMart would price its default store)', async () => {
    const calls = stubFetch();
    const store: ResolvedStore = { storeId: '10744', label: null, eta: null, context: {} };
    await expect(adapter.search('toor dal', store, ctx())).rejects.toThrow(/storeId/);
    expect(calls).toHaveLength(0);
  });
});
