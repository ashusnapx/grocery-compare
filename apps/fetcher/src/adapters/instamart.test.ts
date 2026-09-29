import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../errors';
import {
  buildSearchBody,
  buildSearchUrl,
  isRateLimited,
  money,
  parseCartFeeHints,
  parseSearchResponse,
  parseSelectLocation,
} from './instamart';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../test/fixtures/instamart/${name}`, import.meta.url), 'utf8'));
}

const POD = '1396284';
const FETCHED_AT = '2026-09-27T10:19:55.000Z';

describe('money', () => {
  it('reads Swiggy money objects (rupees + nanos)', () => {
    expect(money({ currencyCode: 'INR', units: '252', nanos: 0 })).toBe(252);
    expect(money({ currencyCode: 'INR', units: '36', nanos: 500000000 })).toBe(36.5);
    expect(money({ units: 'x' })).toBeNull();
    expect(money(undefined)).toBeNull();
  });
});

describe('parseSelectLocation', () => {
  it('reads the pod, layout and SLA for a serviceable point', () => {
    expect(parseSelectLocation(fixture('select-location-koramangala.json'))).toEqual({
      serviceable: true,
      status: 'SERVICEABLE',
      primaryPodId: POD,
      secondaryPodId: null,
      layoutId: '4987',
      eta: '5 Mins',
    });
  });

  it('reads the older probe capture too (pod list with a primary pod)', () => {
    const probe = JSON.parse(readFileSync(new URL('../../../../docs/research/2026-09-27-probe-captures/instamart-select-location.json', import.meta.url), 'utf8'));
    expect(parseSelectLocation(probe)).toMatchObject({ serviceable: true, primaryPodId: POD, layoutId: '4987', eta: '7 Mins' });
  });

  it('says unserviceable when Swiggy says it is not present there', () => {
    expect(parseSelectLocation(fixture('select-location-unserviceable.json'))).toMatchObject({ serviceable: false, status: 'SWIGGY_NOT_PRESENT', primaryPodId: null });
  });

  it('calls an unknown shape an upstream error rather than "unserviceable"', () => {
    expect(() => parseSelectLocation({ statusCode: 0, data: { configs: {} } })).toThrow(UpstreamError);
    expect(() => parseSelectLocation({ statusCode: 7, data: { statusMessage: 'bad lat' } })).toThrow(/bad lat/);
  });
});

describe('parseCartFeeHints', () => {
  it('reads the free-delivery threshold the empty cart announces', () => {
    expect(parseCartFeeHints(fixture('cart-empty-after-location.json'))).toEqual({ freeDeliveryAbove: 199 });
  });

  it('says nothing when the cart has no nudge', () => {
    expect(parseCartFeeHints(fixture('cart-empty-before-location.json'))).toBeUndefined();
  });

  it('still reads ₹199 on 2026-09-29, and never an offer threshold from the brand-offer nudges', () => {
    const cart = fixture('cart-empty-2026-09-29-koramangala.json');
    expect(JSON.stringify(cart)).toMatch(/above ₹499/);
    expect(parseCartFeeHints(cart)).toEqual({ freeDeliveryAbove: 199 });
  });

  it('ignores a nudge that is not about free delivery', () => {
    const cart = { data: { data: { comms: { nudgeComms: { success: { text: 'Get <b>FLAT ₹50 OFF</b> on orders above ₹399' } } } } } };
    expect(parseCartFeeHints(cart)).toBeUndefined();
  });
});

describe('search request', () => {
  it('puts the pods and layout in the query string, like the site', () => {
    expect(buildSearchUrl({ primaryPodId: POD, secondaryPodId: null, layoutId: '4987' })).toBe(
      '/api/instamart/search/v2?offset=0&ageConsent=false&layoutId=4987&voiceSearchTrackingId=&storeId=1396284&primaryStoreId=1396284&secondaryStoreId=',
    );
  });

  it('sends the body the search box sends on Enter', () => {
    expect(JSON.parse(buildSearchBody('amul butter'))).toEqual({
      facets: [],
      sortAttribute: '',
      query: 'amul butter',
      search_results_offset: '0',
      page_type: 'INSTAMART_AUTO_SUGGEST_PAGE',
      is_pre_search_tag: false,
    });
  });

  it('recognises the in-body rate limit', () => {
    expect(isRateLimited({ statusCode: 429 })).toBe(true);
    expect(isRateLimited(fixture('search-onion.json'))).toBe(false);
  });
});

describe('parseSearchResponse', () => {
  const butter = parseSearchResponse(fixture('search-amul-butter.json'), { podIds: [POD], fetchedAt: FETCHED_AT });

  it('makes one listing per pack, read exactly as the page showed it (SOLD OUT, 100 g x 4, ₹252)', () => {
    expect(butter[0]).toEqual({
      platformId: 'instamart',
      listingId: '7MXKNLXAT3',
      title: 'Amul Pasteurised Butter',
      brand: 'Amul',
      quantityText: '100 g x 4',
      price: 252,
      mrp: 252,
      inStock: false,
      productUrl: 'https://www.swiggy.com/instamart/item/TN0BERMP8A',
      imageUrl: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_400/NI_CATALOG/IMAGES/CIW/2026/2/17/450803f3-4b07-49e3-b2f2-ce445c4d45dd_126_1.png',
      category: 'Butter',
      fetchedAt: FETCHED_AT,
    });
    expect(butter.slice(0, 3).map((l) => l.quantityText)).toEqual(['100 g x 4', '100 g x 3', '100 g']);
  });

  it('puts confident matches (grid, then the sold-out card) before low-confidence fillers, and caps at 20', () => {
    expect(butter).toHaveLength(20);
    const firstFiller = butter.findIndex((l) => l.title.startsWith('NOICE'));
    expect(firstFiller).toBe(15);
    expect(butter.slice(0, firstFiller).every((l) => /butter|makkhan/i.test(l.title))).toBe(true);
    expect(butter.find((l) => l.title === 'Amul Safed Makkhan/White Butter')).toMatchObject({ price: 70, inStock: false, quantityText: '100 g' });
    expect(new Set(butter.map((l) => l.listingId)).size).toBe(20);
  });

  it('reads offer price and MRP separately, and drops placeholder brands', () => {
    const onion = parseSearchResponse(fixture('search-onion.json'), { podIds: [POD], fetchedAt: FETCHED_AT });
    expect(onion[0]).toMatchObject({ title: 'Onion (Eerulli)', quantityText: '1 kg', price: 71, mrp: 89, inStock: true, brand: null, category: 'Vegetables' });
    expect(onion.find((l) => l.title === 'nectr Sambar Onion')).toMatchObject({ brand: 'nectr', price: 27, mrp: 36 });
  });

  it('refuses rows priced at a pod the request did not name', () => {
    expect(() => parseSearchResponse(fixture('search-onion.json'), { podIds: ['1398452'], fetchedAt: FETCHED_AT })).toThrow(UpstreamError);
  });

  it('refuses a response whose packs no longer say which pod they are from', () => {
    const json = JSON.parse(readFileSync(new URL('../../test/fixtures/instamart/search-onion.json', import.meta.url), 'utf8').replace(/"podId": "1396284",?/g, ''));
    expect(() => parseSearchResponse(json, { podIds: [POD], fetchedAt: FETCHED_AT })).toThrow(/which pod/);
  });

  it('returns [] when there are no product cards', () => {
    const empty = { statusCode: 0, data: { cards: [{ card: { card: { '@type': 'type.googleapis.com/swiggy.gandalf.widgets.v2.InlineViewFilterSortWidget' } } }] } };
    expect(parseSearchResponse(empty, { podIds: [POD], fetchedAt: FETCHED_AT })).toEqual([]);
  });

  it('calls a refusal envelope an upstream error, not "no results"', () => {
    expect(() => parseSearchResponse({ statusCode: 1, statusMessage: 'Something went wrong' }, { podIds: [POD], fetchedAt: FETCHED_AT })).toThrow(/Something went wrong/);
  });
});
