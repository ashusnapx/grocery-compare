import type { FeeHints, GeoLocation, Listing, PlatformId, StoreInfo } from '@gc/engine';

export interface AdapterContext {
  /** Aborted when the comparison's deadline passes or the client disconnects. */
  signal: AbortSignal;
  log: (message: string) => void;
}

/** A platform's store for a location, plus whatever the adapter needs to search it. */
export interface ResolvedStore extends StoreInfo {
  feeHints?: FeeHints;
  /**
   * Adapter-private state for searches: ids, headers, cookie jars, session
   * keys. Stays inside the fetcher; never sent to the web app.
   */
  context: Record<string, unknown>;
}

/**
 * One platform's integration. Adapters return raw listings; matching, pack
 * fills and pricing plans all happen in the engine, so an adapter never needs
 * to know what the user asked for beyond the search text.
 *
 * Contract:
 *  - resolveStore MUST return null when the platform does not deliver to the
 *    location (→ "not serviceable here"), and MUST NOT guess a store.
 *  - search MUST return [] for "no results" and MUST NOT throw for it.
 *  - Both MUST throw BlockedError / TimeoutError / UpstreamError (../errors)
 *    for failures, so statuses stay honest.
 *  - search MUST refuse rows (throw UpstreamError) when the platform reports a
 *    different location than the store asked for.
 *  - Listing.price is the payable price in INR; quantityText is the platform's
 *    own net-quantity text, untouched; field paths live in named constants.
 */
export interface PlatformAdapter {
  id: PlatformId;
  transport: 'plain' | 'impersonate' | 'browser';
  resolveStore(location: GeoLocation, ctx: AdapterContext): Promise<ResolvedStore | null>;
  search(query: string, store: ResolvedStore, ctx: AdapterContext): Promise<Listing[]>;
}
