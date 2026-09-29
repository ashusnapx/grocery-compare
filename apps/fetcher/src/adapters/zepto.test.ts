import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../errors';
import { buildSearchRequest, parseSearchResponse, parseServiceability, parseStorePage, signRequest, slugify } from './zepto';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../test/fixtures/zepto/${name}`, import.meta.url), 'utf8'));
}

const KORAMANGALA_PRIMARY = '796c71f3-568e-4d6d-8767-87285ad4f23a';
const KORAMANGALA_SECONDARY = '3bf7d17f-4fa3-481d-b14d-66ca5c4f14da';
const FETCHED_AT = '2026-09-27T10:10:35.000Z';

describe('signRequest', () => {
  // Expected values come from an independent (Python hashlib) implementation of
  // the scheme; the scheme itself matched 12 of 12 signatures the live site sent.
  const body = '{"query":"toor dal","pageNumber":0,"intentId":"intent-1","mode":"AUTOSUGGEST","userSessionId":"session-1"}';

  it('hashes body|deviceId|method|requestId|secret|url and then hashes the signature again', () => {
    expect(
      signRequest({ method: 'POST', url: '/user-search-service/api/v3/search', requestId: 'request-1', deviceId: 'device-1', secret: 'xsrf:secret.value', body }),
    ).toEqual({
      signature: '7cda7dec783bfcab45a5c653e7139d1d35eeb51a3331cdd76a9cab9eac2292a9',
      timezone: '71051c4988be2a8687dbc4943ee8346327929702ca93347ca8ecab28e78b23a4',
    });
  });

  it('signs a GET with the literal text "undefined" for the missing body, as the site does', () => {
    expect(
      signRequest({ method: 'GET', url: '/api/v1/user/customer/address/location?latitude=12.9352&longitude=77.6245', requestId: 'request-2', deviceId: 'device-1', secret: 'xsrf:secret.value' }),
    ).toEqual({
      signature: '0463e4d4d9724d6e667280ab5f1d4103b4653fb5dab1a65b2472f1909b6ba5fb',
      timezone: 'dcb8acf0f5f5590f571eb6835568fb50c5ab3883a24ce0654061e7715ee5777c',
    });
  });
});

describe('buildSearchRequest', () => {
  const jar = { device_id: 'device-1', session_id: 'session-1', 'XSRF-TOKEN': 'xsrf:secret.value', csrfSecret: 'csrf-1' };
  const req = buildSearchRequest('toor dal', {
    jar,
    identity: { app_version: '17.0.1', marketplace_type: 'SUPER_SAVER', 'x-widget-id': 'widget-1' },
    store: { storeIds: [KORAMANGALA_PRIMARY, KORAMANGALA_SECONDARY], storeEtas: { [KORAMANGALA_PRIMARY]: 10, [KORAMANGALA_SECONDARY]: 27 } },
    requestId: 'request-1',
    intentId: 'intent-1',
  });

  it('sends the body the site sends on Enter', () => {
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/user-search-service/api/v3/search');
    expect(JSON.parse(req.body!)).toEqual({ query: 'toor dal', pageNumber: 0, intentId: 'intent-1', mode: 'AUTOSUGGEST', userSessionId: 'session-1' });
  });

  it('names the stores and signs the exact body it sends', () => {
    expect(req.headers).toMatchObject({
      store_id: KORAMANGALA_PRIMARY,
      storeid: KORAMANGALA_PRIMARY,
      store_ids: `${KORAMANGALA_PRIMARY},${KORAMANGALA_SECONDARY}`,
      store_etas: JSON.stringify({ [KORAMANGALA_PRIMARY]: 10, [KORAMANGALA_SECONDARY]: 27 }),
      device_id: 'device-1',
      session_id: 'session-1',
      request_id: 'request-1',
      'x-xsrf-token': 'xsrf:secret.value',
      'x-csrf-secret': 'csrf-1',
      'x-widget-id': 'widget-1',
      platform: 'WEB',
      app_version: '17.0.1',
    });
    const expected = signRequest({ method: 'POST', url: req.path, requestId: 'request-1', deviceId: 'device-1', secret: 'xsrf:secret.value', body: req.body });
    expect(req.headers['request-signature']).toBe(expected.signature);
    expect(req.headers['x-timezone']).toBe(expected.timezone);
  });

  it('refuses to build a request without the session cookies', () => {
    expect(() =>
      buildSearchRequest('rice', { jar: {}, identity: {}, store: { storeIds: [KORAMANGALA_PRIMARY], storeEtas: {} }, requestId: 'r', intentId: 'i' }),
    ).toThrow(UpstreamError);
  });
});

describe('parseSearchResponse', () => {
  const json = fixture('search-amul-butter.json');
  const listings = parseSearchResponse(json, { storeIds: [KORAMANGALA_PRIMARY, KORAMANGALA_SECONDARY], fetchedAt: FETCHED_AT });

  it('reads the first card exactly as the page showed it (₹73, MRP ₹85, 1 pack (100 g))', () => {
    expect(listings[0]).toEqual({
      platformId: 'zepto',
      listingId: '18fa8072-a91b-4cb7-ab28-c9f7a0d1404f',
      title: 'Milky Mist Table Butter',
      brand: 'Milky Mist',
      quantityText: '1 pack (100 g)',
      price: 73,
      mrp: 85,
      inStock: true,
      productUrl: 'https://www.zepto.com/pn/milky-mist-table-butter/pvid/18fa8072-a91b-4cb7-ab28-c9f7a0d1404f',
      imageUrl: 'https://cdn.zeptonow.com/production/tr:w-400,ar-1-1,pr-true,f-auto,q-80/cms/product_variant/d5ed3a6f-0f74-4135-bfdc-0f2876f79b3e.jpeg',
      category: 'Butter',
      fetchedAt: FETCHED_AT,
    });
  });

  it('keeps an MRP equal to the price (no discount)', () => {
    const amul = listings.find((l) => l.title === 'Amul Unsalted Cooking Butter' && l.quantityText === '1 pack (100 g)');
    expect(amul).toMatchObject({ price: 65, mrp: 65, brand: 'Amul' });
  });

  it('skips the cross-sell widget and de-duplicates a product shown as ad and organic', () => {
    const ids = listings.map((l) => l.listingId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(listings.filter((l) => l.title === 'Milky Mist Table Butter' && l.quantityText === '1 pack (100 g)')).toHaveLength(1);
    expect(listings.length).toBeGreaterThan(10);
    expect(listings.length).toBeLessThanOrEqual(20);
    for (const l of listings) {
      expect(l.price).toBeGreaterThan(0);
      expect(l.productUrl).toMatch(/^https:\/\/www\.zepto\.com\/pn\/[a-z0-9-]+\/pvid\/[0-9a-f-]{36}$/);
    }
  });

  it('honours the cap', () => {
    expect(parseSearchResponse(json, { storeIds: [KORAMANGALA_PRIMARY], fetchedAt: FETCHED_AT, limit: 3 })).toHaveLength(3);
  });

  it('refuses rows priced at a store the request did not name', () => {
    expect(() => parseSearchResponse(json, { storeIds: ['5ec071fd-78df-41f6-b3ae-7298d9f96a3d'], fetchedAt: FETCHED_AT })).toThrow(UpstreamError);
  });

  it('refuses a response whose rows no longer carry a store', () => {
    const stripped = JSON.parse(JSON.stringify(json)) as { layout: { data: { resolver: { data: { items: { productResponse?: Record<string, unknown> }[] } } } }[] };
    for (const w of stripped.layout) for (const it of w.data.resolver.data.items) delete it.productResponse?.storeId;
    expect(() => parseSearchResponse(stripped, { storeIds: [KORAMANGALA_PRIMARY], fetchedAt: FETCHED_AT })).toThrow(/which store/);
  });

  it('reads stock, paise and placeholder brands', () => {
    const edited = JSON.parse(JSON.stringify(json)) as { layout: { widgetName: string; data: { resolver: { data: { items: { productResponse: Record<string, unknown> & { product: Record<string, unknown> } }[] } } } }[] };
    const first = edited.layout.find((w) => w.widgetName.startsWith('SEARCHED_PRODUCTS'))!.data.resolver.data.items[0].productResponse;
    first.outOfStock = true;
    first.discountedSellingPrice = 3630;
    first.product.brand = 'Unbranded';
    const [l] = parseSearchResponse(edited, { storeIds: [KORAMANGALA_PRIMARY], fetchedAt: FETCHED_AT });
    expect(l).toMatchObject({ inStock: false, price: 36.3, brand: null });
  });

  it('returns [] when the page has no result widgets', () => {
    expect(parseSearchResponse({ layout: [{ widgetName: 'SEARCH_TITLE_WIDGET', data: {} }] }, { storeIds: [KORAMANGALA_PRIMARY], fetchedAt: FETCHED_AT })).toEqual([]);
  });

  it('calls a response without a layout an upstream error, not "no results"', () => {
    expect(() => parseSearchResponse({ message: 'nope' }, { storeIds: [KORAMANGALA_PRIMARY], fetchedAt: FETCHED_AT })).toThrow(UpstreamError);
  });
});

describe('store resolution', () => {
  it('reads the store assignment and ETA from the home layout (get_page)', () => {
    expect(parseStorePage(fixture('get-page-koramangala.json'))).toEqual({
      serviceable: true,
      primaryId: KORAMANGALA_PRIMARY,
      secondaryId: KORAMANGALA_SECONDARY,
      etas: { [KORAMANGALA_PRIMARY]: 10, [KORAMANGALA_SECONDARY]: 27, '5e36e56b-2449-4262-b397-f8af3464f5e3': 23 },
      etaText: '10 minutes',
      city: 'Bengaluru',
      storeName: 'BLR-BTM Layout Network-3',
    });
  });

  it('says unserviceable when Zepto does', () => {
    expect(parseStorePage(fixture('get-page-unserviceable.json'))).toMatchObject({ serviceable: false, primaryId: null });
  });

  it('reads the serviceability cookie the site sets (the fallback)', () => {
    const cookie = JSON.stringify(fixture('serviceability-cookie-koramangala.json'));
    expect(parseServiceability(cookie)).toMatchObject({
      serviceable: true,
      primaryId: 'bf1b6356-328b-4cfa-840e-0b555dab374f',
      secondaryId: KORAMANGALA_SECONDARY,
      etaText: '12 minutes',
      city: 'Bengaluru',
      storeName: 'BLR-27th Main Road',
      etas: { 'bf1b6356-328b-4cfa-840e-0b555dab374f': 12, [KORAMANGALA_SECONDARY]: 27, '5e36e56b-2449-4262-b397-f8af3464f5e3': 26, 'ec682ef5-2217-4c8f-8765-9fd4f3cca8a7': 29 },
    });
    expect(parseServiceability(JSON.stringify(fixture('serviceability-cookie-unserviceable.json')))).toMatchObject({ serviceable: false, primaryId: null });
  });

  it('calls a missing or garbled cookie an upstream error', () => {
    expect(() => parseServiceability(undefined)).toThrow(UpstreamError);
    expect(() => parseServiceability('%7Bnot json')).toThrow(UpstreamError);
    expect(() => parseStorePage({ pageLayout: {} })).toThrow(UpstreamError);
  });
});

describe('slugify', () => {
  it('matches the slugs on the site’s own cards', () => {
    expect(slugify('Sambar Onion Peeled')).toBe('sambar-onion-peeled');
    expect(slugify('Organically Grown Onion')).toBe('organically-grown-onion');
    expect(slugify('Tata Sampann Unpolished Toor Dal | Arhar Dal')).toBe('tata-sampann-unpolished-toor-dal-arhar-dal');
  });
});
