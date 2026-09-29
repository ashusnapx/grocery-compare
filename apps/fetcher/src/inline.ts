/**
 * The fetcher without its HTTP server, for a host that runs the searches
 * itself: the web app on Vercel when no FETCHER_URL is set, or when the one
 * set doesn't answer. Same caches, gates, rests and per-person limits as
 * server.ts, minus the signature, since nothing crosses a network.
 *
 * Zepto and Instamart search through a real Chromium page (transports/
 * browser.ts), and a serverless function has none to launch, so they come back
 * `unavailable` here unless the host says it has one (INLINE_BROWSER=1).
 */
import type { FetcherEvent, FetcherSearchRequest, FetcherSuggestRequest, FetcherSuggestResponse, PlatformId } from '@gc/engine';
import { ADAPTERS } from './adapters/registry';
import { allow } from './ratelimit';
import { runPlatformSearch } from './search';
import { suggestProducts } from './suggest';

const HAS_BROWSER = process.env.INLINE_BROWSER === '1';

/** Whether this host can search the platform at all. */
export function searchableHere(platformId: PlatformId): boolean {
  return HAS_BROWSER || ADAPTERS[platformId].transport !== 'browser';
}

export async function* searchInline(req: FetcherSearchRequest, signal: AbortSignal): AsyncGenerator<FetcherEvent> {
  if (!searchableHere(req.platformId)) {
    const error = 'needs a real browser, which this server doesn’t have';
    yield { type: 'store', status: 'unavailable', store: null, error };
    yield { type: 'done', status: 'unavailable', elapsedMs: 0, error };
    return;
  }
  if (!allow(req.clientIp)) {
    const error = 'too many comparisons — try again in a few minutes';
    yield { type: 'store', status: 'blocked', store: null, error };
    yield { type: 'done', status: 'blocked', elapsedMs: 0, error };
    return;
  }
  yield* runPlatformSearch(req, signal);
}

/** Null when this person is over their typing budget, as the HTTP fetcher's 429. */
export async function suggestInline(req: FetcherSuggestRequest, signal: AbortSignal): Promise<FetcherSuggestResponse | null> {
  if (!allow(req.clientIp, 'suggest')) return null;
  return suggestProducts(req.query, req.location, signal);
}
