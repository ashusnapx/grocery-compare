import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoLocation } from '@gc/engine';
import { UpstreamError } from '../errors';
import adapter, {
  composeTitle,
  CookieJar,
  isServiceabilityError,
  parseHeader,
  parseSearchResponse,
  parseServiceable,
  SessionProblem,
  type BbHeader,
  type BbSearchResponse,
  type BbServiceable,
} from './bigbasket';
import type { AdapterContext } from './types';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../test/fixtures/bigbasket/${name}`, import.meta.url), 'utf8')) as T;
}

const ctx = (): AdapterContext => ({ signal: new AbortController().signal, log: () => {} });
const MUMBAI: GeoLocation = { lat: 19.1364, lng: 72.8296, pincode: '400053', approximate: false };
const MUMBAI_SAS = [15950, 17830, 31353];

// --- fetch stub ----------------------------------------------------------------

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface Canned {
  status?: number;
  body?: unknown;
  cookies?: string[];
}

function stubFetch(...canned: Canned[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined });
      const next = canned.shift();
      if (!next) throw new Error(`unexpected request ${url}`);
      const headers: [string, string][] = (next.cookies ?? []).map((c) => ['set-cookie', c]);
      const status = next.status ?? 200;
      if (status === 204) return new Response(null, { status, headers });
      const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {});
      return new Response(text, { status, headers });
    }),
  );
  return calls;
}

/** The four responses of the site's guest location flow, as seen live for Mumbai. */
function mumbaiLocateFlow(): Canned[] {
  return [
    { body: '<html>guest</html>', cookies: ['_bb_vid=MTQ1MDA4OTYwOTkzNDYzODMxOA==; Path=/', '_bb_aid=MjkxMzA4NDUzMA==; Path=/', '_bb_sa_ids=19224; Path=/'] },
    { body: fixture('serviceable-400053.json'), cookies: ['csurftoken=tok123; Max-Age=1800; Path=/'] },
    { body: {}, cookies: ['_bb_aid="MzE1MTA5MTQ2OA=="; Path=/', '_bb_lat_long=MTkuMTM2NHw3Mi44Mjk2; Path=/', '_bb_cid=4; Path=/'] },
    { body: fixture('header-400053.json') },
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- pure parsers ------------------------------------------------------------------

describe('parseServiceable', () => {
  it('reads BB Now serviceability and the place', () => {
    expect(parseServiceable(fixture('serviceable-400053.json'))).toEqual({
      serviceable: true,
      area: 'Shastri Nagar, Andheri West',
      pincode: '400053',
      city: 'Mumbai',
    });
  });

  it('reads Jaipur as not served: no bbnow entry at all (and scheduled bb-b2c "NA")', () => {
    const jaipur = fixture<BbServiceable>('serviceable-302017.json');
    expect(parseServiceable(jaipur)).toMatchObject({ serviceable: false, city: 'Jaipur', pincode: '302017' });
    expect(jaipur.serviceable_ecs_info!['bb-b2c']).toEqual({ serviceable: 'NA' });
  });

  it('treats NA, bb1.0 and a missing flag as not serviceable (the site rule)', () => {
    for (const flag of ['NA', 'bb1.0', undefined]) {
      const json = fixture<BbServiceable>('serviceable-400053.json');
      json.serviceable_ecs_info!.bbnow = flag === undefined ? null : { serviceable: flag };
      expect(parseServiceable(json).serviceable).toBe(false);
    }
  });
});

describe('isServiceabilityError', () => {
  const refused = JSON.stringify(fixture('serviceable-refused-SERVE4056.json'));

  it('recognises BigBasket refusing the place (HTTP 303 SERVE4056, "SERVICEABILITY ERROR")', () => {
    expect(isServiceabilityError(303, refused)).toBe(true);
    expect(isServiceabilityError(400, JSON.stringify({ errors: [{ code_str: 'SERVE4056' }] }))).toBe(true);
  });

  it('does not mistake a success, another error or a non-JSON page for "not served"', () => {
    expect(isServiceabilityError(200, refused)).toBe(false);
    expect(isServiceabilityError(404, JSON.stringify({ errors: [{ code: 5012, msg: '2 exceptions occurred. ' }] }))).toBe(false);
    expect(isServiceabilityError(503, '<html>Service Unavailable</html>')).toBe(false);
  });
});

describe('parseHeader', () => {
  it('confirms the requested place and returns the BB Now service areas', () => {
    expect(parseHeader(fixture('header-400053.json'), 19.1364, 72.8296)).toEqual({
      saIds: MUMBAI_SAS,
      primarySaId: 15950,
      eta: '5 mins',
      area: 'Shastri Nagar, Andheri West',
      pincode: '400053',
      city: 'Mumbai',
    });
  });

  it('throws when the session sits somewhere else', () => {
    expect(() => parseHeader(fixture('header-400053.json'), 12.9352, 77.6245)).toThrow(/placed the session/);
  });

  it('throws when no service area is named', () => {
    const json = fixture<BbHeader>('header-400053.json');
    json.additional_cookies = {};
    json.next_available_slots = [];
    expect(() => parseHeader(json, 19.1364, 72.8296)).toThrow(UpstreamError);
  });
});

describe('parseSearchResponse', () => {
  it('maps parents and pack-size children, brand rejoined to desc', () => {
    const listings = parseSearchResponse(fixture('search-amul-butter-sa-15950.json'), MUMBAI_SAS, '2026-09-27T10:17:20.000Z');
    expect(listings[0]).toEqual({
      platformId: 'bigbasket',
      listingId: '40006627',
      title: 'Milky Mist Cooking Butter - Unsalted',
      brand: 'Milky Mist',
      quantityText: '500 g',
      price: 389,
      mrp: 400,
      inStock: true,
      productUrl: expect.stringMatching(/^https:\/\/www\.bigbasket\.com\/pd\/40006627\//),
      imageUrl: expect.stringMatching(/^https:\/\/www\.bbassets\.com\//),
      category: expect.any(String),
      fetchedAt: '2026-09-27T10:17:20.000Z',
    });
    const amul100 = listings.find((l) => l.listingId === '104860');
    expect(amul100).toMatchObject({ title: 'Amul Pasteurised Butter', quantityText: '100 g', price: 63, inStock: false });
  });

  it('keeps fractional rupee prices and whole pack-size ladders (Bengaluru toor dal)', () => {
    const listings = parseSearchResponse(fixture('search-toor-dal-sa-18648.json'), [18648]);
    expect(listings.length).toBeLessThanOrEqual(20);
    expect(listings.slice(0, 4).map((l) => [l.listingId, l.quantityText, l.price])).toEqual([
      ['10000804', '2 kg', 319],
      ['10000444', '500 g', 90.48],
      ['10000425', '1 kg', 165],
      ['40042841', '5 kg', 808],
    ]);
    expect(listings[1].title).toBe('bb Royal Toor Dal/Togari Bele - Desi');
  });

  it('refuses rows from the IP-located session (sa 19224) when Mumbai was asked for', () => {
    const ipLocated = fixture<BbSearchResponse>('search-amul-butter-ip-located-sa-19224.json');
    expect(() => parseSearchResponse(ipLocated, MUMBAI_SAS)).toThrow(SessionProblem);
    expect(() => parseSearchResponse(ipLocated, MUMBAI_SAS)).toThrow(UpstreamError);
  });

  it('refuses a response where one child comes from another area', () => {
    const json = fixture<BbSearchResponse>('search-amul-butter-sa-15950.json');
    const parent = json.tabs![0].product_info!.products!.find((p) => p.children?.length)!;
    parent.children![0].visibility = { sa_id: 19224 };
    expect(() => parseSearchResponse(json, MUMBAI_SAS)).toThrow(/service area 19224/);
  });

  it('returns [] for the LLM fallback and throws SessionProblem on an errors payload', () => {
    const llm = fixture<BbSearchResponse>('search-amul-butter-sa-15950.json');
    llm.is_llm_flow = true;
    expect(parseSearchResponse(llm, MUMBAI_SAS)).toEqual([]);
    expect(() => parseSearchResponse({ errors: [{ code: 5012, msg: '2 exceptions occurred. ' }] }, MUMBAI_SAS)).toThrow(SessionProblem);
    expect(() => parseSearchResponse({} as BbSearchResponse, MUMBAI_SAS)).toThrow(UpstreamError);
  });
});

describe('composeTitle and CookieJar', () => {
  it('rejoins a brandless desc, leaves a branded one alone', () => {
    expect(composeTitle('Pasteurised Butter', 'Amul')).toBe('Amul Pasteurised Butter');
    expect(composeTitle('Amul Butter', 'Amul')).toBe('Amul Butter');
    expect(composeTitle('Toor Dal', null)).toBe('Toor Dal');
  });

  it('keeps raw values, drops expired cookies', () => {
    const jar = new CookieJar();
    jar.absorbLine('_bb_aid="MzE1MTA5MTQ2OA=="; Domain=.bigbasket.com; expires=Fri, 26-Mar-2027 10:17:04 GMT; Path=/');
    jar.absorbLine('csurftoken=abc; Max-Age=1800; Path=/');
    jar.absorbLine('gone=x; Path=/');
    jar.absorbLine('gone=; Max-Age=0; Path=/');
    expect(jar.header()).toBe('_bb_aid="MzE1MTA5MTQ2OA=="; csurftoken=abc');
  });
});

// --- the site's location flow, end to end with fetch stubbed ------------------------

describe('adapter (fetch stubbed)', () => {
  it('resolveStore replays the guest location flow and binds the session to the place', async () => {
    const calls = stubFetch(...mumbaiLocateFlow());
    const store = await adapter.resolveStore(MUMBAI, ctx());
    expect(store).toMatchObject({ storeId: '15950', label: 'BB Now Shastri Nagar, Andheri West', eta: '5 mins' });

    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /ps/',
      'GET /ui-svc/v1/serviceable/',
      'PUT /member-svc/v2/member/current-delivery-address/',
      'GET /ui-svc/v2/header',
    ]);
    const serviceable = new URL(calls[1].url);
    expect(serviceable.searchParams.get('lat')).toBe('19.1364');
    expect(serviceable.searchParams.get('lng')).toBe('72.8296');
    const put = calls[2];
    expect(put.headers['x-csurftoken']).toBe('tok123');
    expect(put.headers.cookie).toContain('_bb_vid=');
    expect(JSON.parse(put.body!)).toEqual({
      lat: 19.1364,
      long: 72.8296,
      return_hub_cookies: false,
      area: 'Shastri Nagar, Andheri West',
      contact_zipcode: '400053',
    });
    // The located cookies (PUT) and the header's additional_cookies travel on.
    expect(calls[3].headers.cookie).toContain('_bb_aid="MzE1MTA5MTQ2OA=="');
    expect(store!.context.cookie).toContain('_bb_sa_ids=15950,17830,31353');
    expect(store!.context.cookie).toContain('xentrycontextid=10');
  });

  it('resolveStore returns null when BB Now does not serve the place (no PUT)', async () => {
    const svc = fixture<BbServiceable>('serviceable-400053.json');
    svc.serviceable_ecs_info!.bbnow = { serviceable: 'NA' };
    const [boot] = mumbaiLocateFlow();
    const calls = stubFetch(boot, { body: svc, cookies: ['csurftoken=tok; Path=/'] });
    expect(await adapter.resolveStore(MUMBAI, ctx())).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('resolveStore returns null, not an error, when BigBasket refuses the place (303 SERVE4056)', async () => {
    const [boot] = mumbaiLocateFlow();
    const calls = stubFetch(boot, { status: 303, body: fixture('serviceable-refused-SERVE4056.json') });
    expect(await adapter.resolveStore({ ...MUMBAI, lat: 26.856, lng: 80.991, pincode: '226010' }, ctx())).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('resolveStore returns null when setting the location is refused the same way', async () => {
    const [boot, svc] = mumbaiLocateFlow();
    const calls = stubFetch(boot, svc, { status: 303, body: fixture('serviceable-refused-SERVE4056.json') });
    expect(await adapter.resolveStore(MUMBAI, ctx())).toBeNull();
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'PUT']);
  });

  it('resolveStore still reports other failures of the location steps as errors', async () => {
    const [boot] = mumbaiLocateFlow();
    stubFetch(boot, { status: 500, body: { errors: [{ code: 1, msg: 'boom' }] } });
    await expect(adapter.resolveStore(MUMBAI, ctx())).rejects.toThrow(UpstreamError);
  });

  it('search sends the located session, maps rows, and treats 204 as no results', async () => {
    const calls = stubFetch(...mumbaiLocateFlow(), { body: fixture('search-amul-butter-sa-15950.json') }, { status: 204 });
    const c = ctx();
    const store = (await adapter.resolveStore(MUMBAI, c))!;
    const listings = await adapter.search('amul butter', store, c);
    expect(listings.length).toBeGreaterThan(0);
    const search = new URL(calls[4].url);
    expect(search.pathname).toBe('/listing-svc/v2/products/');
    expect(search.searchParams.get('slug')).toBe('amul butter');
    expect(calls[4].headers.cookie).toBe(store.context.cookie);
    expect(calls[4].headers['x-entry-context-id']).toBe('10');
    expect(await adapter.search('zzqqxxnotaproduct', store, c)).toEqual([]);
  });

  it('refuses rows from a drifted session, and re-locates once when the session is old', async () => {
    const drifted = { body: fixture('search-amul-butter-ip-located-sa-19224.json') };
    stubFetch(...mumbaiLocateFlow(), drifted, drifted, ...mumbaiLocateFlow(), { body: fixture('search-amul-butter-sa-15950.json') });
    const c = ctx();
    const store = (await adapter.resolveStore(MUMBAI, c))!;
    // Fresh session: no re-location, the mismatch is reported.
    await expect(adapter.search('amul butter', store, c)).rejects.toThrow(SessionProblem);
    // Old session: one re-location, then the verified rows.
    store.context.locatedAt = 0;
    const listings = await adapter.search('amul butter', store, c);
    expect(listings[0].listingId).toBe('40006627');
  });

  it('search refuses to run without a located session', async () => {
    const calls = stubFetch();
    await expect(adapter.search('amul butter', { storeId: '1', label: null, eta: null, context: {} }, ctx())).rejects.toThrow(/located session/);
    expect(calls).toHaveLength(0);
  });
});
