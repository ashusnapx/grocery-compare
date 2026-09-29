/**
 * Live product suggestions while typing. Only fast platforms that take a
 * search per keystroke in their stride are asked (Zepto and Instamart need a
 * real browser; DMart's search firewall is easily tripped), with a short deadline;
 * whatever lands in time is returned. Searches share the comparison's
 * minute-long cache, so a comparison started right after typing reuses them.
 */
import { isPlatformId, type FetcherSuggestResponse, type GeoLocation, type PlatformId } from '@gc/engine';
import { lookupStore, restingFor, searchListings, statusOf } from './search';

export const SUGGEST_PLATFORMS: PlatformId[] = (process.env.SUGGEST_PLATFORMS ?? 'blinkit,bigbasket,jiomart')
  .split(',')
  .map((s) => s.trim())
  .filter(isPlatformId);

const SUGGEST_DEADLINE_MS = Number(process.env.SUGGEST_DEADLINE_MS ?? 3500);
const PER_PLATFORM = 8;

export async function suggestProducts(query: string, location: GeoLocation, outer: AbortSignal): Promise<FetcherSuggestResponse> {
  const signal = AbortSignal.any([outer, AbortSignal.timeout(SUGGEST_DEADLINE_MS)]);
  const settled = await Promise.all(
    SUGGEST_PLATFORMS.map(async (platformId) => {
      if (restingFor(platformId)) return { platformId, status: 'blocked' as const, listings: [] };
      try {
        const store = await lookupStore(platformId, location, signal);
        if (!store) return { platformId, status: 'unserviceable' as const, listings: [] };
        const { listings } = await searchListings(platformId, location, store, query, signal);
        const inStock = listings.filter((l) => l.inStock).slice(0, PER_PLATFORM);
        return { platformId, status: inStock.length ? ('ok' as const) : ('no_results' as const), listings: inStock };
      } catch (e) {
        return { platformId, status: statusOf(e), listings: [] };
      }
    }),
  );
  return {
    platforms: settled.map(({ platformId, status }) => ({ platformId, status })),
    listings: settled.flatMap((s) => s.listings),
  };
}
