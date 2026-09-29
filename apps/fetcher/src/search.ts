import type { FetcherEvent, FetcherSearchRequest, GeoLocation, Listing, PlatformId, PlatformStatus } from '@gc/engine';
import { PLATFORMS } from '@gc/engine';
import { ADAPTERS } from './adapters/registry';
import type { AdapterContext, ResolvedStore } from './adapters/types';
import { TtlCache } from './cache';
import { Coalescer, Gate, waitOrAbort } from './concurrency';
import { BlockedError, NotImplementedError, TimeoutError, UnserviceableError } from './errors';

const STORE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Quick-commerce apps reassign dark stores within minutes — Blinkit moved
 * Andheri West between stores in 3 minutes during spike S1 — and a store
 * lookup also carries the fees in force (surge, small cart; JioMart's fee
 * quote), so theirs are re-checked every couple of minutes. BigBasket's lookup
 * creates a guest address on its side, so it is kept longer.
 */
const QUICK_STORE_TTL_MS = Number(process.env.QUICK_STORE_MAX_AGE_MS ?? 2 * 60 * 1000);
const STORE_TTL_BY_PLATFORM: Partial<Record<string, number>> = {
  blinkit: QUICK_STORE_TTL_MS,
  zepto: QUICK_STORE_TTL_MS,
  instamart: QUICK_STORE_TTL_MS,
  jiomart: QUICK_STORE_TTL_MS,
  bigbasket: 6 * 60 * 60 * 1000,
};
/**
 * Prices are shown as live, so a search result is reused for at most a
 * minute: the typing box followed by a comparison, or a comparison run twice.
 */
const SEARCH_TTL_MS = Number(process.env.PRICE_MAX_AGE_MS ?? 60 * 1000);
/** Per platform, per comparison. Leaves headroom inside the 20 s final-plan target. */
const PLATFORM_DEADLINE_MS = Number(process.env.PLATFORM_DEADLINE_MS ?? 15_000);
const CONCURRENCY = 4;

const storeCache = new TtlCache<ResolvedStore | null>(STORE_TTL_MS, 2000);
const searchCache = new TtlCache<Listing[]>(SEARCH_TTL_MS, 20_000);

/** Simultaneous requests to one platform across every user's comparisons. */
const GLOBAL_PER_PLATFORM = Number(process.env.GLOBAL_CONCURRENCY_PER_PLATFORM ?? 8);
const gates = new Map<string, Gate>();
function gate(platformId: string): Gate {
  let g = gates.get(platformId);
  if (!g) gates.set(platformId, (g = new Gate(GLOBAL_PER_PLATFORM)));
  return g;
}
/**
 * After a platform refuses us (firewall, rate limit) it rests: nothing is sent
 * to it for a cool-down that doubles on each repeat refusal (2 → 4 → … 20 min)
 * and resets on the next success. Retrying into a refusal only lengthens it.
 */
const REST_MIN_MS = Number(process.env.BLOCK_REST_MS ?? 2 * 60 * 1000);
const REST_MAX_MS = 20 * 60 * 1000;
const resting = new Map<PlatformId, { until: number; next: number }>();

/** Milliseconds a platform still rests after a refusal; 0 when it is fine to ask. */
export function restingFor(platformId: PlatformId): number {
  return Math.max(0, (resting.get(platformId)?.until ?? 0) - Date.now());
}

function noteRefusal(platformId: PlatformId): void {
  const span = Math.min(resting.get(platformId)?.next ?? REST_MIN_MS, REST_MAX_MS);
  resting.set(platformId, { until: Date.now() + span, next: span * 2 });
  console.log(`[${platformId}] refused us; resting ${Math.round(span / 60_000)} min`);
}

function restingError(platformId: PlatformId): BlockedError {
  return new BlockedError(`busy — refused a moment ago, trying again in ~${Math.max(1, Math.ceil(restingFor(platformId) / 60_000))} min`);
}

// Identical in-flight lookups and searches (same platform, store, query) run once.
const storeFlights = new Coalescer<ResolvedStore | null>();
const searchFlights = new Coalescer<Listing[]>();

/** Shared work outlives any one caller, so it gets its own deadline rather than theirs. */
function sharedContext(platformId: string): AdapterContext {
  return { signal: AbortSignal.timeout(PLATFORM_DEADLINE_MS), log: (m) => console.log(`[${platformId}] ${m}`) };
}

export function statusOf(e: unknown): PlatformStatus {
  if (e instanceof BlockedError) return 'blocked';
  if (e instanceof TimeoutError) return 'timeout';
  if (e instanceof UnserviceableError) return 'unserviceable';
  if (e instanceof Error && e.name === 'AbortError') return 'timeout';
  return 'error';
}

function messageOf(e: unknown): string {
  if (e instanceof NotImplementedError) return e.message;
  return e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
}

function storeKey(platformId: PlatformId, location: GeoLocation): string {
  const { lat, lng, pincode } = location;
  // ~110 m cells for coordinate-located platforms; pincode for the others.
  return PLATFORMS[platformId].locatesBy === 'coordinates'
    ? `${platformId}:${lat.toFixed(3)},${lng.toFixed(3)}`
    : `${platformId}:${pincode}`;
}

export function normaliseQuery(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The platform's store for a location: from the cache, from an identical
 * lookup already in flight, or fetched once (gated per platform). `signal`
 * only bounds how long *this* caller waits. Null = not serviceable.
 */
export async function lookupStore(platformId: PlatformId, location: GeoLocation, signal: AbortSignal): Promise<ResolvedStore | null> {
  const sKey = storeKey(platformId, location);
  const cached = storeCache.get(sKey);
  if (cached !== undefined) return cached;
  const lookup = storeFlights.run(sKey, async () => {
    const found = await gate(platformId).run(() => ADAPTERS[platformId].resolveStore(location, sharedContext(platformId)));
    storeCache.set(sKey, found, found ? (STORE_TTL_BY_PLATFORM[platformId] ?? STORE_TTL_MS) : 60 * 60 * 1000);
    return found;
  });
  return waitOrAbort(lookup, signal);
}

/** One search at a store, reused for at most a minute and merged with identical searches in flight. */
export async function searchListings(
  platformId: PlatformId,
  location: GeoLocation,
  store: ResolvedStore,
  text: string,
  signal: AbortSignal,
): Promise<{ listings: Listing[]; cached: boolean }> {
  const key = `${platformId}:${store.storeId}:${normaliseQuery(text)}`;
  const cached = searchCache.get(key);
  if (cached) return { listings: cached, cached: true };
  if (restingFor(platformId)) throw restingError(platformId);
  try {
    const flight = searchFlights.run(key, async () => {
      const found = await gate(platformId).run(() => ADAPTERS[platformId].search(text, store, sharedContext(platformId)));
      searchCache.set(key, found);
      resting.delete(platformId);
      return found;
    });
    return { listings: await waitOrAbort(flight, signal), cached: false };
  } catch (e) {
    if (statusOf(e) === 'blocked') {
      // A blocked session may get through with a fresh store lookup next time — after a rest.
      storeCache.delete(storeKey(platformId, location));
      if (!restingFor(platformId)) noteRefusal(platformId);
    }
    throw e;
  }
}

/**
 * One platform, many queries: resolve the store, then run searches with
 * bounded concurrency, yielding each result the moment it lands.
 */
export async function* runPlatformSearch(req: FetcherSearchRequest, outer: AbortSignal): AsyncGenerator<FetcherEvent> {
  const started = Date.now();
  const deadline = AbortSignal.timeout(PLATFORM_DEADLINE_MS);
  // This caller's own deadline; the platform work itself is shared (see sharedContext).
  const signal = AbortSignal.any([outer, deadline]);

  // A platform resting after a refusal is not asked at all this time.
  if (restingFor(req.platformId)) {
    const error = restingError(req.platformId).message;
    yield { type: 'store', status: 'blocked', store: null, error };
    yield { type: 'done', status: 'blocked', elapsedMs: Date.now() - started, error };
    return;
  }

  // --- store -------------------------------------------------------------
  let store: ResolvedStore | null;
  try {
    store = await lookupStore(req.platformId, req.location, signal);
  } catch (e) {
    const status = deadline.aborted ? 'timeout' : statusOf(e);
    yield { type: 'store', status, store: null, error: messageOf(e) };
    yield { type: 'done', status, elapsedMs: Date.now() - started, error: messageOf(e) };
    return;
  }
  if (!store) {
    yield { type: 'store', status: 'unserviceable', store: null };
    yield { type: 'done', status: 'unserviceable', elapsedMs: Date.now() - started };
    return;
  }
  const { context: _private, ...publicStore } = store;
  yield { type: 'store', status: 'ok', store: publicStore, feeHints: store.feeHints };

  // --- searches ------------------------------------------------------------
  const queue = [...req.queries];
  const results: FetcherEvent[] = [];
  let wake: (() => void) | null = null;
  let active = 0;
  const statuses: PlatformStatus[] = [];

  const runOne = async (q: { itemId: string; text: string }) => {
    let event: FetcherEvent;
    try {
      const { listings, cached } = await searchListings(req.platformId, req.location, store!, q.text, signal);
      event = { type: 'query', itemId: q.itemId, text: q.text, status: listings.length ? 'ok' : 'no_results', listings, cached };
    } catch (e) {
      const status = deadline.aborted ? 'timeout' : statusOf(e);
      event = { type: 'query', itemId: q.itemId, text: q.text, status, listings: [], error: messageOf(e), cached: false };
    }
    statuses.push(event.type === 'query' ? event.status : 'error');
    results.push(event);
    wake?.();
  };

  const pump = () => {
    while (active < CONCURRENCY && queue.length && !signal.aborted) {
      const q = queue.shift()!;
      active++;
      void runOne(q).finally(() => {
        active--;
        pump();
      });
    }
  };
  pump();

  // One abort listener for the whole loop (adding one per wait leaks listeners).
  const onAbort = () => wake?.();
  signal.addEventListener('abort', onAbort, { once: true });

  let emitted = 0;
  while (emitted < req.queries.length) {
    if (results.length === 0) {
      if (signal.aborted && active === 0) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
      continue;
    }
    const ev = results.shift()!;
    emitted++;
    yield ev;
  }

  signal.removeEventListener('abort', onAbort);

  // Queries never started because the deadline passed.
  for (const q of queue) {
    statuses.push('timeout');
    yield { type: 'query', itemId: q.itemId, text: q.text, status: 'timeout', listings: [], cached: false, error: 'deadline passed' };
  }

  const status: PlatformStatus = statuses.includes('ok')
    ? 'ok'
    : statuses.includes('blocked')
      ? 'blocked'
      : statuses.includes('timeout')
        ? 'timeout'
        : statuses.includes('error')
          ? 'error'
          : 'no_results';
  yield { type: 'done', status, elapsedMs: Date.now() - started };
}
